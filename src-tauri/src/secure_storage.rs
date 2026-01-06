use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const NONCE_SIZE: usize = 12;

/// Get a stable machine identifier that persists across app restarts.
fn get_machine_id() -> String {
    let mut components = Vec::new();

    // Get hostname
    if let Ok(hostname) = hostname::get() {
        components.push(hostname.to_string_lossy().to_string());
    }

    // Get username
    if let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("USERNAME")) {
        components.push(user);
    }

    // macOS: Use IOPlatformUUID (hardware UUID)
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        components.push(uuid.to_string());
                        break;
                    }
                }
            }
        }
    }

    // Windows: Use MachineGuid from registry
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                if line.contains("MachineGuid") {
                    if let Some(guid) = line.split_whitespace().last() {
                        components.push(guid.to_string());
                        break;
                    }
                }
            }
        }
    }

    // Linux: Use /etc/machine-id
    #[cfg(target_os = "linux")]
    {
        if let Ok(machine_id) = fs::read_to_string("/etc/machine-id") {
            components.push(machine_id.trim().to_string());
        }
    }

    components.push("com.sidestream.secure".to_string());
    components.join("::")
}

/// Derive a 32-byte encryption key from the machine ID using SHA-256.
fn derive_key() -> [u8; 32] {
    let machine_id = get_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    hasher.finalize().into()
}

/// Get the path to the encrypted keys file
fn get_keys_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("keys.enc"))
}

/// Encrypt data using AES-256-GCM
fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate a random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.extend(ciphertext);
    Ok(result)
}

/// Decrypt data using AES-256-GCM
fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_SIZE {
        return Err("Data too short".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce = Nonce::from_slice(&data[..NONCE_SIZE]);
    let ciphertext = &data[NONCE_SIZE..];

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

/// Load all API keys from the encrypted file
fn load_keys(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = get_keys_path(app)?;

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let encrypted = fs::read(&path).map_err(|e| format!("Failed to read keys file: {}", e))?;
    let key = derive_key();
    let decrypted = decrypt(&key, &encrypted)?;

    let json_str =
        String::from_utf8(decrypted).map_err(|e| format!("Invalid UTF-8 in keys: {}", e))?;

    serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse keys: {}", e))
}

/// Save all API keys to the encrypted file
fn save_keys(app: &tauri::AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = get_keys_path(app)?;
    let json_str = serde_json::to_string(keys).map_err(|e| format!("Failed to serialize: {}", e))?;
    let key = derive_key();
    let encrypted = encrypt(&key, json_str.as_bytes())?;

    fs::write(&path, encrypted).map_err(|e| format!("Failed to write keys file: {}", e))
}

/// Save an API key to the secure store
pub async fn save_api_key_secure(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
) -> Result<(), String> {
    let mut keys = load_keys(app)?;
    let key_name = format!("{}_api_key", provider);
    keys.insert(key_name, api_key.to_string());
    save_keys(app, &keys)
}

/// Get an API key from the secure store
pub async fn get_api_key_secure(
    app: &tauri::AppHandle,
    provider: &str,
) -> Result<String, String> {
    let keys = load_keys(app)?;
    let key_name = format!("{}_api_key", provider);
    keys.get(&key_name)
        .cloned()
        .ok_or_else(|| format!("{} API key not found", provider))
}

/// Delete an API key from the secure store
pub async fn delete_api_key_secure(
    app: &tauri::AppHandle,
    provider: &str,
) -> Result<(), String> {
    let mut keys = load_keys(app)?;
    let key_name = format!("{}_api_key", provider);
    keys.remove(&key_name);
    save_keys(app, &keys)
}

/// Check if an API key exists in the secure store
pub async fn has_api_key_secure(app: &tauri::AppHandle, provider: &str) -> bool {
    get_api_key_secure(app, provider).await.is_ok()
}
