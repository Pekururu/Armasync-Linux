//! Partial downloads from the `.zsync` files Arma3Sync writes next to every
//! file in an HTTP repository. Blocks the local copy already has are reused,
//! and only the rest is fetched with HTTP range requests.
use super::*;
use md4::Md4;
use std::os::unix::fs::FileExt;

/// Larger `.zsync` files are ignored and the file downloads whole.
const MAX_CONTROL_SIZE: usize = 64 * 1024 * 1024;
/// Smaller files download whole: the `.zsync` request would cost more than it saves.
const MIN_PARTIAL_SIZE: u64 = 1024 * 1024;
/// Missing ranges closer together than this are fetched in one request.
const MERGE_GAP: u64 = 256 * 1024;
const SCAN_CHUNK: usize = 4 * 1024 * 1024;
const FILTER_BITS: u32 = 20;

#[derive(Debug)]
pub(super) struct ControlFile {
    pub(super) block_size: usize,
    pub(super) length: u64,
    pub(super) sha1: Option<String>,
    rsum_bytes: usize,
    checksum_bytes: usize,
    weak: Vec<u32>,
    strong: Vec<u8>,
}

impl ControlFile {
    fn block_count(&self) -> usize {
        self.weak.len()
    }

    fn strong(&self, block: usize) -> &[u8] {
        &self.strong[block * self.checksum_bytes..(block + 1) * self.checksum_bytes]
    }

    fn weak_mask(&self) -> u32 {
        if self.rsum_bytes == 4 {
            u32::MAX
        } else {
            (1 << (8 * self.rsum_bytes)) - 1
        }
    }
}

fn invalid(message: &str) -> RepositoryError {
    RepositoryError::Sync(format!("invalid zsync file: {message}"))
}

pub(super) fn parse_control(bytes: &[u8]) -> Result<ControlFile, RepositoryError> {
    let mut position = 0;
    let mut block_size = None;
    let mut length = None;
    let mut hash_lengths = None;
    let mut sha1 = None;
    loop {
        let end = bytes[position..]
            .iter()
            .position(|byte| *byte == b'\n')
            .ok_or_else(|| invalid("header never ends"))?;
        let line = std::str::from_utf8(&bytes[position..position + end])
            .map_err(|_| invalid("header is not text"))?
            .trim_end_matches('\r');
        position += end + 1;
        if line.is_empty() {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            return Err(invalid("header line without a colon"));
        };
        let value = value.trim();
        match key {
            "Blocksize" => block_size = value.parse::<usize>().ok(),
            "Length" => length = value.parse::<u64>().ok(),
            "Hash-Lengths" => {
                let parts = value
                    .split(',')
                    .map(|part| part.trim().parse::<usize>().ok())
                    .collect::<Option<Vec<_>>>();
                hash_lengths = parts.filter(|parts| parts.len() == 3);
            }
            "SHA-1" => sha1 = Some(value.to_ascii_lowercase()),
            // Compressed zsync targets need a gzip-aware matcher.
            "Z-URL" | "Z-Map2" | "Recompress" => {
                return Err(invalid("compressed targets are not supported"));
            }
            _ => {}
        }
    }
    let block_size = block_size
        .filter(|size| size.is_power_of_two() && (512..=1024 * 1024).contains(size))
        .ok_or_else(|| invalid("bad block size"))?;
    let length = length.ok_or_else(|| invalid("no length"))?;
    let hash_lengths = hash_lengths.ok_or_else(|| invalid("bad hash lengths"))?;
    let (rsum_bytes, checksum_bytes) = (hash_lengths[1], hash_lengths[2]);
    if !(1..=2).contains(&hash_lengths[0])
        || !(1..=4).contains(&rsum_bytes)
        || !(1..=16).contains(&checksum_bytes)
    {
        return Err(invalid("bad hash lengths"));
    }
    let blocks = usize::try_from(length.div_ceil(block_size as u64))
        .map_err(|_| invalid("too many blocks"))?;
    let record = rsum_bytes + checksum_bytes;
    if bytes.len() - position != blocks.saturating_mul(record) {
        return Err(invalid("checksum table has the wrong size"));
    }
    let mut weak = Vec::with_capacity(blocks);
    let mut strong = Vec::with_capacity(blocks * checksum_bytes);
    for entry in bytes[position..].chunks_exact(record) {
        weak.push(
            entry[..rsum_bytes]
                .iter()
                .fold(0u32, |sum, byte| (sum << 8) | u32::from(*byte)),
        );
        strong.extend_from_slice(&entry[rsum_bytes..]);
    }
    Ok(ControlFile {
        block_size,
        length,
        sha1,
        rsum_bytes,
        checksum_bytes,
        weak,
        strong,
    })
}

/// zsync's rolling sum over one window: `a` is the byte sum and `b` weights
/// each byte by its distance from the window's end. Both wrap at 16 bits.
fn rolling_sum(window: &[u8]) -> (u16, u16) {
    let size = window.len();
    window
        .iter()
        .enumerate()
        .fold((0u16, 0u16), |(a, b), (index, byte)| {
            let byte = u16::from(*byte);
            (
                a.wrapping_add(byte),
                b.wrapping_add(((size - index) as u16).wrapping_mul(byte)),
            )
        })
}

fn filter_slot(key: u32) -> usize {
    (key.wrapping_mul(0x9E37_79B1) >> (32 - FILTER_BITS)) as usize
}

/// For each block of the target, where the same bytes start in `local`.
pub(super) fn match_blocks(
    control: &ControlFile,
    local: &mut impl Read,
    control_flow: &SyncControl,
) -> Result<Vec<Option<u64>>, RepositoryError> {
    let size = control.block_size;
    let mask = control.weak_mask();
    let mut found = vec![None; control.block_count()];
    let mut blocks_by_weak: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut filter = vec![0u64; (1 << FILTER_BITS) / 64];
    for (block, weak) in control.weak.iter().enumerate() {
        blocks_by_weak.entry(*weak).or_default().push(block);
        let slot = filter_slot(*weak);
        filter[slot / 64] |= 1 << (slot % 64);
    }

    let mut buffer = vec![0u8; SCAN_CHUNK + size];
    let (mut start, mut filled, mut base) = (0usize, 0usize, 0u64);
    let mut end_of_file = false;
    let mut sums = None;
    loop {
        if filled - start <= size && !end_of_file {
            control_flow.checkpoint()?;
            buffer.copy_within(start..filled, 0);
            base += start as u64;
            filled -= start;
            start = 0;
            while filled < buffer.len() {
                let count = local.read(&mut buffer[filled..]).map_err(local_error)?;
                if count == 0 {
                    end_of_file = true;
                    break;
                }
                filled += count;
            }
        }
        if filled - start < size {
            break;
        }
        let window = &buffer[start..start + size];
        let (a, b) = *sums.get_or_insert_with(|| rolling_sum(window));
        let key = ((u32::from(a) << 16) | u32::from(b)) & mask;
        let slot = filter_slot(key);
        if filter[slot / 64] & (1 << (slot % 64)) != 0
            && let Some(candidates) = blocks_by_weak.get(&key)
        {
            let digest = Md4::digest(window);
            let mut matched = false;
            for block in candidates {
                if control.strong(*block) == &digest[..control.checksum_bytes] {
                    found[*block].get_or_insert(base + start as u64);
                    matched = true;
                }
            }
            if matched {
                start += size;
                sums = None;
                continue;
            }
        }
        if filled - start == size {
            break;
        }
        let (old, new) = (u16::from(buffer[start]), u16::from(buffer[start + size]));
        let a = a.wrapping_sub(old).wrapping_add(new);
        let b = b
            .wrapping_sub((size as u16).wrapping_mul(old))
            .wrapping_add(a);
        sums = Some((a, b));
        start += 1;
    }
    Ok(found)
}

/// Byte ranges of the target that no local block covers, end exclusive.
pub(super) fn missing_ranges(control: &ControlFile, found: &[Option<u64>]) -> Vec<(u64, u64)> {
    let size = control.block_size as u64;
    let mut ranges: Vec<(u64, u64)> = Vec::new();
    for (block, _) in found.iter().enumerate().filter(|(_, at)| at.is_none()) {
        let start = block as u64 * size;
        let end = (start + size).min(control.length);
        match ranges.last_mut() {
            Some(last) if start - last.1 <= MERGE_GAP => last.1 = end,
            _ => ranges.push((start, end)),
        }
    }
    ranges
}

pub(super) fn worth_trying(endpoint: &TransferEndpoint, entry: &ManifestEntry) -> bool {
    endpoint.protocol == TransferProtocol::Https
        && !entry.compressed
        && entry.sha1.is_some()
        && entry.size >= MIN_PARTIAL_SIZE
}

/// Bytes counted toward progress, so they can be taken back if the partial
/// download gives up and the file downloads whole.
#[derive(Default)]
pub(super) struct Credit {
    pub(super) progress: u64,
    pub(super) reused: u64,
}

/// Builds `target` from the local copy of `entry` plus ranges of the remote
/// file. `Ok(false)` means a partial download isn't possible for this file.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_partial(
    client: &reqwest::blocking::Client,
    endpoint: &TransferEndpoint,
    entry: &ManifestEntry,
    root: &Directory,
    target: &Path,
    control_flow: &SyncControl,
    before_read: &mut dyn FnMut() -> Result<(), RepositoryError>,
    credit: &mut Credit,
    on_bytes: &mut dyn FnMut(u64) -> Result<(), RepositoryError>,
) -> Result<bool, RepositoryError> {
    let mut local = match root.read(&entry.local_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(local_error(error)),
    };
    if local.metadata().map_err(local_error)?.len() == 0 {
        return Ok(false);
    }
    let remote = entry.remote_path.to_string_lossy().replace('\\', "/");
    let control = parse_control(&fetch_https_bytes(
        client,
        endpoint,
        &format!("{remote}.zsync"),
        MAX_CONTROL_SIZE,
    )?)?;
    // A stale .zsync describes some other version of the file.
    if control.length != entry.size
        || control.sha1.as_deref().is_some_and(|sha1| {
            !entry
                .sha1
                .as_deref()
                .unwrap_or("")
                .eq_ignore_ascii_case(sha1)
        })
    {
        return Ok(false);
    }
    let found = match_blocks(&control, &mut local, control_flow)?;
    if found.iter().all(Option::is_none) {
        return Ok(false);
    }

    let file = root.create(target).map_err(local_error)?;
    file.set_len(control.length).map_err(local_error)?;
    let size = control.block_size as u64;
    let mut block_bytes = vec![0u8; control.block_size];
    for (block, at) in found.iter().enumerate() {
        let Some(at) = at else { continue };
        before_read()?;
        let offset = block as u64 * size;
        let bytes = &mut block_bytes[..(control.length - offset).min(size) as usize];
        local.read_exact_at(bytes, *at).map_err(local_error)?;
        file.write_all_at(bytes, offset).map_err(local_error)?;
        credit.progress += bytes.len() as u64;
        credit.reused += bytes.len() as u64;
        on_bytes(bytes.len() as u64)?;
    }

    for (start, end) in missing_ranges(&control, &found) {
        let url = https_resource_url(endpoint, &remote)?;
        let mut request = client
            .get(url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .header(reqwest::header::RANGE, format!("bytes={start}-{}", end - 1));
        if !endpoint.login.is_empty() {
            request = request.basic_auth(&endpoint.login, Some(&endpoint.password));
        }
        let mut response = request
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| RepositoryError::Transfer(format!("{remote}: {error}")))?;
        let expected_range = format!("bytes {start}-{}/{}", end - 1, control.length);
        let range_matches = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.trim() == expected_range);
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT || !range_matches {
            // The server ignores ranges, so a partial download can't work.
            return Ok(false);
        }
        let mut writer = OffsetWriter {
            file: &file,
            offset: start,
        };
        stream_exact(
            &mut response,
            &mut writer,
            end - start,
            &remote,
            &mut *before_read,
            |count| {
                credit.progress += count as u64;
                on_bytes(count as u64)
            },
        )?;
    }
    file.sync_all().map_err(local_error)?;
    Ok(true)
}

struct OffsetWriter<'a> {
    file: &'a std::fs::File,
    offset: u64,
}

impl Write for OffsetWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.file.write_all_at(bytes, self.offset)?;
        self.offset += bytes.len() as u64;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a `.zsync` file the way Arma3Sync's jazsync does.
    fn make_control(
        data: &[u8],
        block_size: usize,
        rsum_bytes: usize,
        checksum_bytes: usize,
    ) -> Vec<u8> {
        let mut bytes = format!(
            "zsync: jazsync\nFilename: test.pbo\nMTime: Sat, 26 Sep 2026 12:00:00 +0200\nBlocksize: {block_size}\nLength: {}\nHash-Lengths: 2,{rsum_bytes},{checksum_bytes}\nURL: https://example.invalid/test.pbo\nSHA-1: {:x}\n\n",
            data.len(),
            Sha1::digest(data)
        )
        .into_bytes();
        for chunk in data.chunks(block_size) {
            let mut block = chunk.to_vec();
            block.resize(block_size, 0);
            let (a, b) = rolling_sum(&block);
            let weak = [(a >> 8) as u8, a as u8, (b >> 8) as u8, b as u8];
            bytes.extend_from_slice(&weak[4 - rsum_bytes..]);
            bytes.extend_from_slice(&Md4::digest(&block)[..checksum_bytes]);
        }
        bytes
    }

    fn pseudo_random(length: usize, seed: u32) -> Vec<u8> {
        let mut state = seed;
        (0..length)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as u8
            })
            .collect()
    }

    fn rebuild(control: &ControlFile, local: &[u8], remote: &[u8]) -> (Vec<u8>, u64) {
        let found = match_blocks(control, &mut Cursor::new(local), &SyncControl::new()).unwrap();
        let mut output = vec![0u8; control.length as usize];
        let size = control.block_size;
        for (block, at) in found.iter().enumerate() {
            if let Some(at) = at {
                let start = block * size;
                let end = (start + size).min(output.len());
                output[start..end]
                    .copy_from_slice(&local[*at as usize..*at as usize + end - start]);
            }
        }
        let mut fetched = 0;
        for (start, end) in missing_ranges(control, &found) {
            output[start as usize..end as usize]
                .copy_from_slice(&remote[start as usize..end as usize]);
            fetched += end - start;
        }
        (output, fetched)
    }

    #[test]
    fn md4_matches_the_rfc_vectors() {
        assert_eq!(
            format!("{:x}", Md4::digest(b"abc")),
            "a448017aaf21d8525fc10ae87aa6729d"
        );
    }

    #[test]
    fn rolling_matches_a_fresh_sum_after_each_step() {
        let data = pseudo_random(4096 + 50, 7);
        let size = 4096;
        let (mut a, mut b) = rolling_sum(&data[..size]);
        for start in 0..50 {
            let (old, new) = (u16::from(data[start]), u16::from(data[start + size]));
            a = a.wrapping_sub(old).wrapping_add(new);
            b = b
                .wrapping_sub((size as u16).wrapping_mul(old))
                .wrapping_add(a);
            assert_eq!((a, b), rolling_sum(&data[start + 1..start + 1 + size]));
        }
    }

    #[test]
    fn parses_a_jazsync_header_and_table() {
        let data = pseudo_random(20_000, 1);
        let control = parse_control(&make_control(&data, 8192, 3, 5)).unwrap();
        assert_eq!(control.block_size, 8192);
        assert_eq!(control.length, 20_000);
        assert_eq!(control.block_count(), 3);
        assert_eq!(
            control.sha1.as_deref(),
            Some(format!("{:x}", Sha1::digest(&data)).as_str())
        );
    }

    #[test]
    fn rejects_a_truncated_table() {
        let data = pseudo_random(20_000, 1);
        let mut bytes = make_control(&data, 8192, 4, 16);
        bytes.pop();
        assert!(parse_control(&bytes).is_err());
    }

    #[test]
    fn reuses_shifted_blocks_and_fetches_only_the_change() {
        for rsum_bytes in 2..=4 {
            let old = pseudo_random(4 << 20, 3);
            let mut new = old[..1_000_000].to_vec();
            new.extend_from_slice(b"an inserted patch that shifts everything after it");
            new.extend_from_slice(&old[1_000_000..3_000_000]);
            new.extend_from_slice(&pseudo_random(10_000, 9));
            new.extend_from_slice(&old[3_010_000..]);
            let control = parse_control(&make_control(&new, 2048, rsum_bytes, 6)).unwrap();
            let (rebuilt, fetched) = rebuild(&control, &old, &new);
            assert_eq!(rebuilt, new);
            assert!(fetched < 20 * 1024, "fetched {fetched} bytes");
        }
    }

    #[test]
    fn unrelated_local_files_reuse_nothing() {
        let old = pseudo_random(64 * 1024, 11);
        let new = pseudo_random(64 * 1024, 12);
        let control = parse_control(&make_control(&new, 2048, 4, 8)).unwrap();
        let found = match_blocks(&control, &mut Cursor::new(&old), &SyncControl::new()).unwrap();
        assert!(found.iter().all(Option::is_none));
        assert_eq!(
            missing_ranges(&control, &found),
            vec![(0, new.len() as u64)]
        );
    }
}
