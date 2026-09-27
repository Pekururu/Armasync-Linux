import type { RepositorySnapshot } from "../bindings";
import type { Repositories } from "../state/repositories";
import { useEffect, useState } from "react";
import { bytes, plural } from "../format";
import { Banner, Dialog, Icon, Status } from "../ui";
import { DestinationField } from "./Repos";

type Inspection = { url: string; snapshot: RepositorySnapshot } | { url: string; error: string } | null;

/** The link is inspected first, so you see what you're adding before anything is saved. */
export default function AddRepository({ open, onClose, repos, onAdded }: { open: boolean; onClose: () => void; repos: Repositories; onAdded: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");
  const [inspection, setInspection] = useState<Inspection>(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importing = repos.job?.kind === "import";

  useEffect(() => {
    if (!open) return;
    setUrl(""); setInspection(null); setError(null);
    setDestination(repos.defaultDestination ?? "");
  }, [open]);

  useEffect(() => {
    const link = url.trim();
    if (!/^[a-z]+:\/\/\S+/i.test(link)) { setInspection(null); setInspecting(false); return; }
    let current = true;
    setInspecting(true);
    const timeout = window.setTimeout(() => {
      repos.inspect(link)
        .then((snapshot) => { if (current) setInspection({ url: link, snapshot }); })
        .catch((cause) => { if (current) setInspection({ url: link, error: String(cause) }); })
        .finally(() => { if (current) setInspecting(false); });
    }, 500);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [url]);

  const ready = inspection && "snapshot" in inspection && inspection.url === url.trim() ? inspection.snapshot : null;

  async function add() {
    if (!ready || !destination.trim()) return;
    setError(null);
    try {
      const id = await repos.importRepository(url.trim(), destination.trim());
      if (id) onAdded(id);
    } catch (cause) { setError(String(cause)); }
  }

  return <Dialog open={open} onClose={onClose} busy={importing} eyebrow="Arma3Sync compatible" title="Add repository"
    actions={<>
      <button type="button" className="k-btn k-btn-quiet" disabled={importing} onClick={onClose}>Cancel</button>
      <button type="button" className="k-btn k-btn-primary" disabled={importing || !ready || !destination.trim()} onClick={() => void add()}>{importing ? "Adding…" : "Add And Download"}</button>
    </>}>
    <div className="k-field">
      <label className="k-field-label" htmlFor="autoconfig-link">Autoconfig link</label>
      <input id="autoconfig-link" className="k-input" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org/.a3s/autoconfig" autoFocus />
    </div>

    {inspecting && <div className="k-card as-sunken as-inspection"><Status status="doing" cut="var(--surface-sunken)">Checking the link</Status></div>}
    {!inspecting && ready && <div className="k-card as-sunken as-inspection">
      <Status status="done" cut="var(--surface-sunken)" />
      <div className="as-stack-hair as-grow as-min0">
        <span className="headline as-ellipsis">{ready.repository.name}</span>
        <span className="subtext k-muted">{plural(ready.addons.length, "mod")}. {bytes(ready.manifest.totalBytes)}. {plural(ready.publishedModsets.length, "modset")}.</span>
        <span className="subtext k-muted as-inline as-spaced"><Icon name="lock" />{ready.repository.protocol.toUpperCase()}. {ready.repository.anonymous ? "No login needed." : "Login stays in memory and is never saved."}</span>
      </div>
    </div>}
    {!inspecting && inspection && "error" in inspection && inspection.url === url.trim() && <div className="k-card as-sunken as-inspection">
      <Status status="exception" cut="var(--surface-sunken)" />
      <div className="as-stack-hair as-grow as-min0"><span className="headline">Couldn't read this link</span><span className="subtext k-muted">{inspection.error}</span></div>
    </div>}

    <DestinationField value={destination} onChange={setDestination} needBytes={ready?.manifest.totalBytes} />
    {error && <Banner tone="danger" title="Couldn't add the repository">{error}</Banner>}
  </Dialog>;
}
