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

/// Map a file extension to a MIME type
/// Returns the MIME type for known extensions
pub fn extension_to_mime(filename: &str) -> Option<&'static str> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "csv" => Some("text/csv"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xls" => Some("application/vnd.ms-excel"),
        "pdf" => Some("application/pdf"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "json" => Some("application/json"),
        "txt" => Some("text/plain"),
        "html" | "htm" => Some("text/html"),
        "zip" => Some("application/zip"),
        "xml" => Some("application/xml"),
        "py" => Some("text/x-python"),
        "js" => Some("text/javascript"),
        "ts" => Some("text/typescript"),
        "java" => Some("text/x-java"),
        "c" => Some("text/x-c"),
        "cpp" | "cc" | "cxx" => Some("text/x-c++"),
        "md" => Some("text/markdown"),
        _ => None,
    }
}
