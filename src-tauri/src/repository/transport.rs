use super::*;

pub(super) async fn download_autoconfig(
    source_url: &str,
) -> Result<RepositoryEndpoint, RepositoryError> {
    let parsed =
        Url::parse(source_url).map_err(|error| RepositoryError::InvalidUrl(error.to_string()))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(RepositoryError::InsecureUrl);
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| RepositoryError::Download(error.to_string()))?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| RepositoryError::Download(error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_AUTOCONFIG_SIZE as u64)
    {
        return Err(RepositoryError::TooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| RepositoryError::Download(error.to_string()))?
    {
        if chunk.len() > MAX_AUTOCONFIG_SIZE.saturating_sub(bytes.len()) {
            return Err(RepositoryError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }

    decode_autoconfig(&bytes, source_url)
}

pub(super) fn make_transfer_endpoint(
    endpoint: &RepositoryEndpoint,
) -> Result<TransferEndpoint, RepositoryError> {
    let protocol = match endpoint.info.protocol.as_str() {
        "FTP" => TransferProtocol::Ftp,
        "HTTPS" => TransferProtocol::Https,
        protocol => {
            return Err(RepositoryError::Unsupported(format!(
                "transfer protocol {protocol} is not implemented yet"
            )));
        }
    };
    let default_port = match protocol {
        TransferProtocol::Ftp => 21,
        TransferProtocol::Https => 443,
    };
    Ok(TransferEndpoint {
        protocol,
        host: endpoint.info.host.clone(),
        port: endpoint.info.port.unwrap_or(default_port),
        login: endpoint.login.clone(),
        password: endpoint.password.clone(),
    })
}

pub(super) fn https_client() -> Result<reqwest::blocking::Client, RepositoryError> {
    reqwest::blocking::Client::builder()
        .connect_timeout(HTTPS_CONNECT_TIMEOUT)
        // For blocking responses this is applied to each network read, so a
        // healthy large download can run for hours while a stalled one stops.
        .timeout(HTTPS_READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" {
                attempt.error("HTTPS repository redirected to an insecure URL")
            } else if attempt.previous().len() >= 10 {
                attempt.error("too many HTTPS repository redirects")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| RepositoryError::Transfer(error.to_string()))
}

pub(super) fn https_resource_url(
    endpoint: &TransferEndpoint,
    remote_path: &str,
) -> Result<Url, RepositoryError> {
    let host = endpoint.host.trim();
    let base = if host.contains("://") {
        host.to_owned()
    } else {
        format!("https://{host}")
    };
    let mut url = Url::parse(&base)
        .map_err(|error| RepositoryError::Transfer(format!("invalid HTTPS host: {error}")))?;
    if url.scheme() != "https" || url.cannot_be_a_base() {
        return Err(RepositoryError::Transfer(
            "HTTPS repository host is not a valid HTTPS URL".into(),
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(RepositoryError::Transfer(
            "HTTPS repository host contains unsupported URL parts".into(),
        ));
    }
    let port = u16::try_from(endpoint.port)
        .map_err(|_| RepositoryError::Transfer("invalid HTTPS port".into()))?;
    if port != 443 {
        url.set_port(Some(port))
            .map_err(|_| RepositoryError::Transfer("invalid HTTPS port".into()))?;
    }
    {
        let mut segments = url.path_segments_mut().map_err(|_| {
            RepositoryError::Transfer("HTTPS repository host cannot contain paths".into())
        })?;
        segments.pop_if_empty();
        segments.extend(remote_path.split('/').filter(|segment| !segment.is_empty()));
    }
    Ok(url)
}

pub(super) fn https_request(
    client: &reqwest::blocking::Client,
    endpoint: &TransferEndpoint,
    remote_path: &str,
) -> Result<reqwest::blocking::Response, RepositoryError> {
    let url = https_resource_url(endpoint, remote_path)?;
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    if !endpoint.login.is_empty() {
        request = request.basic_auth(&endpoint.login, Some(&endpoint.password));
    }
    request
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| RepositoryError::Transfer(format!("{remote_path}: {error}")))
}

pub(super) fn fetch_https_bytes(
    client: &reqwest::blocking::Client,
    endpoint: &TransferEndpoint,
    remote_path: &str,
    max_size: usize,
) -> Result<Vec<u8>, RepositoryError> {
    let response = https_request(client, endpoint, remote_path)?;
    if response
        .content_length()
        .is_some_and(|size| size > max_size as u64)
    {
        return Err(RepositoryError::TooLarge);
    }
    let mut bytes = Vec::new();
    response
        .take(max_size as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| RepositoryError::Transfer(format!("{remote_path}: {error}")))?;
    if bytes.len() > max_size {
        return Err(RepositoryError::TooLarge);
    }
    Ok(bytes)
}

pub(super) fn fetch_repository_metadata(
    endpoint: &TransferEndpoint,
) -> Result<(SyncManifest, Vec<PublishedModset>), RepositoryError> {
    if endpoint.protocol == TransferProtocol::Https {
        let client = https_client()?;
        let manifest_bytes = fetch_https_bytes(&client, endpoint, ".a3s/sync", MAX_MANIFEST_SIZE)?;
        let events_bytes =
            fetch_https_bytes(&client, endpoint, ".a3s/events", MAX_AUTOCONFIG_SIZE)?;
        return Ok((
            decode_manifest(&manifest_bytes)?,
            decode_events(&events_bytes)?,
        ));
    }

    let mut ftp = connect_ftp(endpoint)?;
    let manifest_bytes = fetch_ftp_bytes(&mut ftp, ".a3s/sync", MAX_MANIFEST_SIZE)?;
    let events_bytes = fetch_ftp_bytes(&mut ftp, ".a3s/events", MAX_AUTOCONFIG_SIZE)?;
    let _ = ftp.quit();
    Ok((
        decode_manifest(&manifest_bytes)?,
        decode_events(&events_bytes)?,
    ))
}

fn fetch_ftp_bytes(
    ftp: &mut FtpStream,
    path: &str,
    limit: usize,
) -> Result<Vec<u8>, RepositoryError> {
    ftp.retr(path, |reader| {
        let mut bytes = Vec::new();
        reader
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(FtpError::ConnectionError)?;
        if bytes.len() > limit {
            return Err(as_ftp_io_error(RepositoryError::TooLarge));
        }
        Ok(bytes)
    })
    .map_err(|error| RepositoryError::Transfer(error.to_string()))
}

pub(super) fn connect_ftp(endpoint: &TransferEndpoint) -> Result<FtpStream, RepositoryError> {
    let port = u16::try_from(endpoint.port)
        .map_err(|_| RepositoryError::Transfer("invalid FTP port".into()))?;
    let address = (endpoint.host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?
        .next()
        .ok_or_else(|| RepositoryError::Transfer("host did not resolve".into()))?;
    let mut ftp = FtpStream::connect_timeout(address, Duration::from_secs(10))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp = ftp.passive_stream_builder(|address| {
        let stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(10))
            .map_err(FtpError::ConnectionError)?;
        stream
            .set_read_timeout(Some(Duration::from_secs(20)))
            .map_err(FtpError::ConnectionError)?;
        stream
            .set_write_timeout(Some(Duration::from_secs(20)))
            .map_err(FtpError::ConnectionError)?;
        Ok(stream)
    });
    ftp.get_ref()
        .set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.get_ref()
        .set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.login(&endpoint.login, &endpoint.password)
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.transfer_type(FileType::Binary)
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    Ok(ftp)
}

pub(super) fn stage_downloads<F>(
    endpoint: &TransferEndpoint,
    entries: &[&ManifestEntry],
    staging_root: &Directory,
    total_bytes: u64,
    control: &SyncControl,
    on_progress: &F,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    let worker_count = download_worker_count(entries.len());
    let next_entry = AtomicUsize::new(0);
    let completed_files = AtomicUsize::new(0);
    let downloaded_bytes = AtomicU64::new(0);
    let failed = AtomicBool::new(false);
    let failure = Mutex::new(None::<RepositoryError>);
    let progress_gate = Mutex::new((0_u64, Instant::now()));

    on_progress(SyncProgress {
        phase: SyncPhase::Downloading,
        downloaded_bytes: 0,
        total_bytes,
        completed_files: 0,
        total_files: entries.len(),
        current_file: None,
    });

    std::thread::scope(|scope| {
        let mut workers = Vec::with_capacity(worker_count);
        for _ in 0..worker_count {
            workers.push(scope.spawn(|| {
                let result = (|| {
                    let mut ftp = match endpoint.protocol {
                        TransferProtocol::Ftp => Some(connect_ftp(endpoint)?),
                        TransferProtocol::Https => None,
                    };
                    let https = match endpoint.protocol {
                        TransferProtocol::Ftp => None,
                        TransferProtocol::Https => Some(https_client()?),
                    };
                    loop {
                        control.checkpoint()?;
                        if failed.load(Ordering::Acquire) {
                            break;
                        }
                        let index = next_entry.fetch_add(1, Ordering::AcqRel);
                        let Some(entry) = entries.get(index).copied() else {
                            break;
                        };
                        if let Some(client) = &https {
                            download_entry_https(
                                client,
                                endpoint,
                                entry,
                                staging_root,
                                total_bytes,
                                entries.len(),
                                control,
                                &failed,
                                &downloaded_bytes,
                                &completed_files,
                                &progress_gate,
                                on_progress,
                            )?;
                        } else if let Some(ftp) = &mut ftp {
                            download_entry(
                                ftp,
                                entry,
                                staging_root,
                                total_bytes,
                                entries.len(),
                                control,
                                &failed,
                                &downloaded_bytes,
                                &completed_files,
                                &progress_gate,
                                on_progress,
                            )?;
                        }
                    }
                    if let Some(mut ftp) = ftp {
                        let _ = ftp.quit();
                    }
                    Ok::<(), RepositoryError>(())
                })();
                if let Err(error) = result {
                    if let Ok(mut first) = failure.lock()
                        && first.is_none()
                    {
                        *first = Some(error);
                    }
                    failed.store(true, Ordering::Release);
                }
            }));
        }
        for worker in workers {
            if worker.join().is_err() {
                failed.store(true, Ordering::Release);
                if let Ok(mut first) = failure.lock()
                    && first.is_none()
                {
                    *first = Some(RepositoryError::Sync(
                        "a repository download worker stopped unexpectedly".into(),
                    ));
                }
            }
        }
    });

    let mut failure = failure
        .lock()
        .map_err(|_| RepositoryError::Sync("download state lock was poisoned".into()))?;
    if let Some(error) = failure.take() {
        Err(error)
    } else {
        Ok(())
    }
}

pub(super) fn stream_exact<R, W, B, A>(
    reader: &mut R,
    writer: &mut W,
    expected: u64,
    label: &str,
    mut before_read: B,
    mut after_write: A,
) -> Result<(), RepositoryError>
where
    R: Read + ?Sized,
    W: Write,
    B: FnMut() -> Result<(), RepositoryError>,
    A: FnMut(usize) -> Result<(), RepositoryError>,
{
    let mut received = 0_u64;
    let mut buffer = [0_u8; 256 * 1024];
    loop {
        before_read()?;
        let count = reader
            .read(&mut buffer)
            .map_err(|error| RepositoryError::Transfer(format!("{label}: {error}")))?;
        if count == 0 {
            break;
        }
        received = received.saturating_add(count as u64);
        if received > expected {
            return Err(RepositoryError::TooLarge);
        }
        writer
            .write_all(&buffer[..count])
            .map_err(|error| RepositoryError::Sync(error.to_string()))?;
        after_write(count)?;
    }
    if received != expected {
        return Err(RepositoryError::Transfer(format!(
            "{label}: expected {expected} bytes, received {received}"
        )));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn download_entry_https<F>(
    client: &reqwest::blocking::Client,
    endpoint: &TransferEndpoint,
    entry: &ManifestEntry,
    staging_root: &Directory,
    total_bytes: u64,
    total_files: usize,
    control: &SyncControl,
    failed: &AtomicBool,
    downloaded_bytes: &AtomicU64,
    completed_files: &AtomicUsize,
    progress_gate: &Mutex<(u64, Instant)>,
    on_progress: &F,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    let ready = staging_path(entry);
    let target = ready.with_extension("part");
    match staging_root.remove(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(local_error(error)),
    }
    let mut file = staging_root.create(&target).map_err(local_error)?;
    let remote = entry.remote_path.to_string_lossy().replace('\\', "/");
    let current_file = entry.local_path.to_string_lossy().into_owned();
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;

    let mut response = https_request(client, endpoint, &remote)?;
    if response
        .content_length()
        .is_some_and(|size| size > entry.size)
    {
        return Err(RepositoryError::TooLarge);
    }
    stream_exact(
        &mut response,
        &mut file,
        entry.size,
        &remote,
        || {
            control.checkpoint()?;
            if failed.load(Ordering::Acquire) {
                Err(RepositoryError::Cancelled)
            } else {
                Ok(())
            }
        },
        |count| {
            downloaded_bytes.fetch_add(count as u64, Ordering::AcqRel);
            emit_download_progress(
                downloaded_bytes,
                completed_files,
                total_bytes,
                total_files,
                &current_file,
                progress_gate,
                on_progress,
                false,
            )
        },
    )?;
    file.sync_all()
        .map_err(|error| RepositoryError::Sync(error.to_string()))?;
    control.checkpoint()?;
    verify_file(
        staging_root,
        &target,
        entry.size,
        entry.sha1.as_deref(),
        control,
    )?;
    staging_root.rename(&target, &ready).map_err(local_error)?;
    completed_files.fetch_add(1, Ordering::AcqRel);
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn download_entry<F>(
    ftp: &mut FtpStream,
    entry: &ManifestEntry,
    staging_root: &Directory,
    total_bytes: u64,
    total_files: usize,
    control: &SyncControl,
    failed: &AtomicBool,
    downloaded_bytes: &AtomicU64,
    completed_files: &AtomicUsize,
    progress_gate: &Mutex<(u64, Instant)>,
    on_progress: &F,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    let ready = staging_path(entry);
    let target = ready.with_extension("part");
    match staging_root.remove(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(local_error(error)),
    }
    let mut file = staging_root.create(&target).map_err(local_error)?;
    let remote = entry.remote_path.to_string_lossy().replace('\\', "/");
    let current_file = entry.local_path.to_string_lossy().into_owned();
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;

    ftp.retr(&remote, |reader| {
        stream_exact(
            reader,
            &mut file,
            entry.size,
            &remote,
            || {
                control.checkpoint()?;
                if failed.load(Ordering::Acquire) {
                    Err(RepositoryError::Cancelled)
                } else {
                    Ok(())
                }
            },
            |count| {
                downloaded_bytes.fetch_add(count as u64, Ordering::AcqRel);
                emit_download_progress(
                    downloaded_bytes,
                    completed_files,
                    total_bytes,
                    total_files,
                    &current_file,
                    progress_gate,
                    on_progress,
                    false,
                )
            },
        )
        .map_err(as_ftp_io_error)?;
        Ok(())
    })
    .map_err(|error| RepositoryError::Transfer(format!("{remote}: {error}")))?;
    file.sync_all()
        .map_err(|error| RepositoryError::Sync(error.to_string()))?;
    control.checkpoint()?;
    verify_file(
        staging_root,
        &target,
        entry.size,
        entry.sha1.as_deref(),
        control,
    )?;
    staging_root.rename(&target, &ready).map_err(local_error)?;
    completed_files.fetch_add(1, Ordering::AcqRel);
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn emit_download_progress<F>(
    downloaded_bytes: &AtomicU64,
    completed_files: &AtomicUsize,
    total_bytes: u64,
    total_files: usize,
    current_file: &str,
    progress_gate: &Mutex<(u64, Instant)>,
    on_progress: &F,
    force: bool,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress),
{
    let mut gate = progress_gate
        .lock()
        .map_err(|_| RepositoryError::Sync("download progress lock was poisoned".into()))?;
    let current_bytes = downloaded_bytes.load(Ordering::Acquire);
    if force
        || current_bytes.saturating_sub(gate.0) >= 1024 * 1024
        || gate.1.elapsed() >= Duration::from_millis(100)
    {
        on_progress(SyncProgress {
            phase: SyncPhase::Downloading,
            downloaded_bytes: current_bytes,
            total_bytes,
            completed_files: completed_files.load(Ordering::Acquire),
            total_files,
            current_file: Some(current_file.to_owned()),
        });
        *gate = (current_bytes, Instant::now());
    }
    Ok(())
}

pub(super) fn as_ftp_io_error(error: RepositoryError) -> FtpError {
    FtpError::ConnectionError(std::io::Error::other(error.to_string()))
}

pub(super) fn download_worker_count(file_count: usize) -> usize {
    file_count.clamp(1, MAX_PARALLEL_DOWNLOADS)
}

#[cfg(test)]
mod ftp_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    fn server(contents: Vec<u8>) -> (TransferEndpoint, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let (mut control, _) = listener.accept().unwrap();
            control
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(control.try_clone().unwrap());
            control.write_all(b"220 Fixture server\r\n").unwrap();
            let mut passive = None;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                match line.split_whitespace().next().unwrap_or("") {
                    "USER" => control.write_all(b"230 Logged in\r\n").unwrap(),
                    "TYPE" => control.write_all(b"200 Binary\r\n").unwrap(),
                    command @ ("PASV" | "EPSV") => {
                        let data = TcpListener::bind("127.0.0.1:0").unwrap();
                        let port = data.local_addr().unwrap().port();
                        let response = if command == "EPSV" {
                            format!("229 Entering Extended Passive Mode (|||{port}|)\r\n")
                        } else {
                            format!(
                                "227 Entering Passive Mode (127,0,0,1,{},{})\r\n",
                                port / 256,
                                port % 256
                            )
                        };
                        control.write_all(response.as_bytes()).unwrap();
                        passive = Some(data);
                    }
                    "RETR" => {
                        control.write_all(b"150 Opening data\r\n").unwrap();
                        let (mut stream, _) = passive.take().unwrap().accept().unwrap();
                        stream
                            .set_write_timeout(Some(Duration::from_secs(3)))
                            .unwrap();
                        let _ = stream.write_all(&contents);
                        drop(stream);
                        let _ = control.write_all(b"226 Complete\r\n");
                    }
                    "QUIT" => {
                        let _ = control.write_all(b"221 Goodbye\r\n");
                        break;
                    }
                    _ => {
                        control.write_all(b"500 Unsupported\r\n").unwrap();
                    }
                }
            }
        });
        (
            TransferEndpoint {
                protocol: TransferProtocol::Ftp,
                host: "127.0.0.1".into(),
                port: i32::from(port),
                login: "anonymous".into(),
                password: String::new(),
            },
            worker,
        )
    }

    #[test]
    fn ftp_rejects_oversized_and_truncated_files_before_installing() {
        for contents in [b"data".to_vec(), b"da".to_vec(), b"dataEXTRA".to_vec()] {
            let valid = contents == b"data";
            let (endpoint, worker) = server(contents);
            let mut ftp = connect_ftp(&endpoint).unwrap();
            let temp = tempfile::tempdir().unwrap();
            let root = Directory::open(temp.path()).unwrap();
            let entry = ManifestEntry {
                remote_path: "@Test/file".into(),
                local_path: "@Test/file".into(),
                addon_name: "@Test".into(),
                addon_remote_root: "@Test".into(),
                size: 4,
                compressed_size: 0,
                sha1: Some(format!("{:x}", Sha1::digest(b"data"))),
                compressed: false,
            };
            let result = download_entry(
                &mut ftp,
                &entry,
                &root,
                4,
                1,
                &SyncControl::new(),
                &AtomicBool::new(false),
                &AtomicU64::new(0),
                &AtomicUsize::new(0),
                &Mutex::new((0, Instant::now())),
                &|_| {},
            );
            assert_eq!(result.is_ok(), valid);
            assert_eq!(root.read(&staging_path(&entry)).is_ok(), valid);
            if !valid {
                assert!(
                    root.read(&staging_path(&entry).with_extension("part"))
                        .unwrap()
                        .metadata()
                        .unwrap()
                        .len()
                        <= 4
                );
            }
            drop(ftp);
            worker.join().unwrap();
        }
    }

    #[test]
    fn ftp_metadata_is_bounded_during_receipt() {
        let (endpoint, worker) = server(b"too much metadata".to_vec());
        let mut ftp = connect_ftp(&endpoint).unwrap();
        assert!(fetch_ftp_bytes(&mut ftp, ".a3s/sync", 4).is_err());
        drop(ftp);
        worker.join().unwrap();
    }
}
