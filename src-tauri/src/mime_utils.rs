/// Shared MIME type utilities for file handling across providers

/// Map a MIME type to a file extension
/// Returns the extension without the leading dot
pub fn mime_to_extension(mime_type: &str) -> Option<&'static str> {
    // Handle mime types with parameters (e.g., "text/csv; charset=utf-8")
    let mime_type = mime_type.split(';').next().unwrap_or(mime_type).trim();

    match mime_type {
        "text/csv" => Some("csv"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/pdf" => Some("pdf"),
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "application/json" => Some("json"),
        "text/plain" => Some("txt"),
        "text/html" => Some("html"),
        "application/zip" => Some("zip"),
        "application/xml" | "text/xml" => Some("xml"),
        _ => None,
    }
}

/// Get extension from MIME type, falling back to the subtype
pub fn mime_to_extension_or_subtype(mime_type: &str) -> &str {
    mime_to_extension(mime_type).unwrap_or_else(|| {
        mime_type.split('/').last().unwrap_or("bin")
    })
}
