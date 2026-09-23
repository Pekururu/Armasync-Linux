use super::*;

pub(super) fn decode_autoconfig(
    bytes: &[u8],
    source_url: &str,
) -> Result<RepositoryEndpoint, RepositoryError> {
    let root = decode_root(bytes, MAX_AUTOCONFIG_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.AutoConfig" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected root class {}",
            root.class_name()
        )));
    }

    let name = string_field(&root, "repositoryName")?;
    let protocol = root
        .get_field("protocole")
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported("missing protocol object".into()))?;
    let host = string_field(protocol, "url")?;
    let port = optional_string_field(protocol, "port").and_then(|value| value.parse().ok());
    let login = optional_string_field(protocol, "login").unwrap_or_default();
    let password = optional_string_field(protocol, "password").unwrap_or_default();
    let protocol_name = protocol
        .get_field("protocolType")
        .and_then(Value::enum_data)
        .map(|(_, value)| value.to_owned())
        .ok_or_else(|| RepositoryError::Unsupported("missing protocol type".into()))?;

    if protocol_name != "FTP" && protocol_name != "HTTPS" {
        return Err(RepositoryError::Unsupported(format!(
            "transfer protocol {protocol_name} is not implemented yet"
        )));
    }

    Ok(RepositoryEndpoint {
        info: RepositoryInfo {
            name,
            protocol: protocol_name,
            host,
            port,
            path: None,
            anonymous: login.is_empty() || login.eq_ignore_ascii_case("anonymous"),
            source_url: source_url.to_owned(),
        },
        login,
        password,
    })
}

pub(super) fn decode_manifest(bytes: &[u8]) -> Result<SyncManifest, RepositoryError> {
    let root = decode_root(bytes, MAX_MANIFEST_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.SyncTreeDirectory" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected manifest root class {}",
            root.class_name()
        )));
    }
    let mut manifest = SyncManifest {
        summary: ManifestSummary {
            directories: 0,
            files: 0,
            total_bytes: 0,
            compressed_files: 0,
            addon_roots: 0,
            unhashed_files: 0,
        },
        entries: Vec::new(),
    };
    walk_directory(&root, Path::new(""), true, None, &mut manifest)?;
    Ok(manifest)
}

#[derive(Clone)]
pub(super) struct AddonContext {
    pub(super) name: String,
    pub(super) remote_root: PathBuf,
}

pub(super) fn should_start_addon(
    marked_as_addon: bool,
    inherited_addon: Option<&AddonContext>,
) -> bool {
    marked_as_addon && inherited_addon.is_none_or(|parent| !parent.name.starts_with('@'))
}

pub(super) fn decode_events(bytes: &[u8]) -> Result<Vec<PublishedModset>, RepositoryError> {
    let root = decode_root(bytes, MAX_AUTOCONFIG_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.Events" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected events root class {}",
            root.class_name()
        )));
    }

    let mut modsets = Vec::new();
    for value in list_field(&root, "list")? {
        let event = value
            .object_data()
            .ok_or_else(|| RepositoryError::Unsupported("event is not an object".into()))?;
        if event.class_name() != "fr.soe.a3s.domain.repository.Event" {
            return Err(RepositoryError::Unsupported(format!(
                "unexpected event class {}",
                event.class_name()
            )));
        }
        let mut addons = hash_map_string_keys(event, "addonNames")?;
        let mut userconfig_folders = hash_map_string_keys(event, "userconfigFolderNames")?;
        // HashMap serialization has no semantic launch order. Sorting here is
        // only for stable display/diff output; profiles supply real ordering.
        addons.sort_by_key(|value| value.to_ascii_lowercase());
        userconfig_folders.sort_by_key(|value| value.to_ascii_lowercase());
        modsets.push(PublishedModset {
            name: string_field(event, "name")?,
            description: optional_string_field(event, "description").unwrap_or_default(),
            addons,
            userconfig_folders,
        });
    }
    modsets.sort_by_key(|event| event.name.to_ascii_lowercase());
    Ok(modsets)
}

pub(super) fn hash_map_string_keys(
    object: &ObjectData,
    field: &str,
) -> Result<Vec<String>, RepositoryError> {
    let map = object
        .get_field(field)
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing map {field}")))?;
    if map.class_name() != "java.util.HashMap" {
        return Err(RepositoryError::Unsupported(format!(
            "{field} is not a HashMap"
        )));
    }
    let mut annotations = map
        .get_annotation(0)
        .ok_or_else(|| RepositoryError::Unsupported("HashMap has no content".into()))?;
    let _capacity = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    let size = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    if !(0..=100_000).contains(&size) {
        return Err(RepositoryError::Unsupported("invalid HashMap size".into()));
    }
    let mut keys = Vec::with_capacity(size as usize);
    for _ in 0..size {
        let key = annotations
            .read_object()
            .map_err(|error| RepositoryError::Serialization(error.to_string()))?
            .string()
            .ok_or_else(|| RepositoryError::Unsupported("map key is not a string".into()))?;
        let _value = annotations
            .read_object()
            .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
        safe_component(key)?;
        keys.push(key.to_owned());
    }
    Ok(keys)
}

pub(super) fn walk_directory(
    directory: &ObjectData,
    parent: &Path,
    is_root: bool,
    inherited_addon: Option<AddonContext>,
    manifest: &mut SyncManifest,
) -> Result<(), RepositoryError> {
    let name = string_field(directory, "name")?;
    let path = if is_root {
        parent.to_owned()
    } else {
        parent.join(safe_component(&name)?)
    };
    manifest.summary.directories += 1;
    let marked_as_addon = !is_root && bool_field(directory, "markAsAddon").unwrap_or(false);
    let starts_new_addon = should_start_addon(marked_as_addon, inherited_addon.as_ref());
    if starts_new_addon {
        manifest.summary.addon_roots += 1;
    }
    let addon = if starts_new_addon {
        Some(AddonContext {
            name: name.clone(),
            remote_root: path.clone(),
        })
    } else {
        inherited_addon
    };

    for value in list_field(directory, "list")? {
        let child = value
            .object_data()
            .ok_or_else(|| RepositoryError::Unsupported("tree child is not an object".into()))?;
        match child.class_name() {
            "fr.soe.a3s.domain.repository.SyncTreeDirectory" => {
                walk_directory(child, &path, false, addon.clone(), manifest)?;
            }
            "fr.soe.a3s.domain.repository.SyncTreeLeaf" => {
                if bool_field(child, "deleted").unwrap_or(false) {
                    continue;
                }
                let file_name = string_field(child, "name")?;
                let size = long_field(child, "size")?;
                let compressed_size = long_field(child, "compressedSize").unwrap_or(0);
                let sha1_value = string_field(child, "sha1")?;
                let sha1 = if sha1_value == "0" && size == 0 {
                    manifest.summary.unhashed_files += 1;
                    None
                } else if sha1_value.len() == 40
                    && sha1_value.bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    Some(sha1_value)
                } else {
                    return Err(RepositoryError::Unsupported(format!(
                        "invalid SHA-1 for {file_name}"
                    )));
                };
                let compressed = bool_field(child, "compressed").unwrap_or(false);
                let Some(addon) = addon.as_ref() else {
                    return Err(RepositoryError::Unsupported(format!(
                        "file {file_name} is not inside a marked addon root"
                    )));
                };
                let relative_parent = path.strip_prefix(&addon.remote_root).map_err(|_| {
                    RepositoryError::Unsupported("addon ancestry is inconsistent".into())
                })?;
                let remote_path = path.join(safe_component(&file_name)?);
                let local_path = PathBuf::from(&addon.name)
                    .join(relative_parent)
                    .join(safe_component(&file_name)?);
                manifest.summary.files += 1;
                manifest.summary.total_bytes = manifest.summary.total_bytes.saturating_add(size);
                if compressed {
                    manifest.summary.compressed_files += 1;
                }
                manifest.entries.push(ManifestEntry {
                    remote_path,
                    local_path,
                    addon_name: addon.name.clone(),
                    addon_remote_root: addon.remote_root.clone(),
                    size,
                    compressed_size,
                    sha1,
                    compressed,
                });
            }
            class => {
                return Err(RepositoryError::Unsupported(format!(
                    "unexpected manifest node {class}"
                )));
            }
        }
    }
    Ok(())
}

pub(super) fn list_field<'a>(
    object: &'a ObjectData,
    field: &str,
) -> Result<Vec<&'a Value>, RepositoryError> {
    let list = object
        .get_field(field)
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing list {field}")))?;
    if list.class_name() != "java.util.ArrayList" {
        return Err(RepositoryError::Unsupported(format!(
            "{field} is not an ArrayList"
        )));
    }
    let size = int_field(list, "size")?;
    if !(0..=1_000_000).contains(&size) {
        return Err(RepositoryError::Unsupported("invalid list size".into()));
    }
    let mut annotations = list
        .get_annotation(0)
        .ok_or_else(|| RepositoryError::Unsupported("ArrayList has no content".into()))?;
    let written_size = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    if written_size != size {
        return Err(RepositoryError::Unsupported(
            "ArrayList size markers disagree".into(),
        ));
    }
    (0..size)
        .map(|_| {
            annotations
                .read_object()
                .map_err(|error| RepositoryError::Serialization(error.to_string()))
        })
        .collect()
}

pub(super) fn decode_root(bytes: &[u8], limit: usize) -> Result<ObjectData, RepositoryError> {
    let mut raw = Vec::new();
    GzDecoder::new(Cursor::new(bytes))
        .take(limit as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|error| RepositoryError::Compression(error.to_string()))?;
    if raw.len() > limit {
        return Err(RepositoryError::TooLarge);
    }
    let mut parser = Parser::new(Cursor::new(raw))
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    match parser
        .read()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?
    {
        Content::Object(Value::Object(object)) => Ok(object),
        _ => Err(RepositoryError::Unsupported("root is not an object".into())),
    }
}

pub(super) fn safe_component(name: &str) -> Result<&str, RepositoryError> {
    let path = Path::new(name);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) if name != "." && name != ".." => Ok(name),
        _ => Err(RepositoryError::UnsafePath(name.to_owned())),
    }
}

pub(super) fn string_field(object: &ObjectData, name: &str) -> Result<String, RepositoryError> {
    optional_string_field(object, name)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing {name}")))
}

pub(super) fn optional_string_field(object: &ObjectData, name: &str) -> Option<String> {
    object.get_field(name)?.string().map(ToOwned::to_owned)
}

pub(super) fn bool_field(object: &ObjectData, name: &str) -> Option<bool> {
    match object.get_field(name)?.primitive()? {
        PrimitiveType::Boolean(value) => Some(*value),
        _ => None,
    }
}

pub(super) fn int_field(object: &ObjectData, name: &str) -> Result<i32, RepositoryError> {
    match object.get_field(name).and_then(Value::primitive) {
        Some(PrimitiveType::Int(value)) => Ok(*value),
        _ => Err(RepositoryError::Unsupported(format!(
            "missing integer {name}"
        ))),
    }
}

pub(super) fn long_field(object: &ObjectData, name: &str) -> Result<u64, RepositoryError> {
    match object.get_field(name).and_then(Value::primitive) {
        Some(PrimitiveType::Long(value)) => u64::try_from(*value)
            .map_err(|_| RepositoryError::Unsupported(format!("negative {name}"))),
        _ => Err(RepositoryError::Unsupported(format!("missing long {name}"))),
    }
}
