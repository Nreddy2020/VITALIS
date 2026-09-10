"""Produce a pilot-only diff against the imported E: working baseline, not old HEAD."""
import difflib
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
files = [
    'server.js', 'index.html', 'package.json', 'README.md',
    'engine/drift/request_drift.js', 'engine/drift/relationships.js', 'engine/drift/relationship_rules.json',
    'docs/00_START_HERE.md', 'docs/01_CHARTER_read_this_first.md', 'docs/03_Competitive_Reality.md',
    'docs/09_Internal_Adoption_Proposal.md', 'docs/17_Stage9_Compatibility_Drift.md',
    'docs/18_Stage10_Request_Path_Drift.md', 'docs/28_Request_Compatibility_Pilot.md',
    'tests/fixtures/relationship_pilot.js', 'tests/verify_relationship_pilot.js',
    'tests/verify_relationship_console.js', 'tests/serve_relationship_pilot.js',
    'tests/capture_fin_health.py', 'tests/verify_fin_capture.js',
    'tests/verify_node_live_capture.js', 'tests/run_pilot_regressions.js', 'tests/build_pilot_review.py'
]
capacity = '--capacity' in sys.argv
idempotency = '--idempotency' in sys.argv or capacity
storage = '--storage' in sys.argv or idempotency
architecture = '--architecture' in sys.argv or storage
mobile = '--mobile' in sys.argv or architecture
if mobile:
    files += ['.gitignore', 'engine/ingestion/fetch_observer.js',
        'docs/29_Mobile_Origin_Pilot.md', 'tests/prepare_fin_mobile.py',
        'tests/prepare_fin_mobile_dependencies.ps1', 'tests/capture_fin_mobile_backend.py',
        'tests/verify_fetch_observer.js', 'tests/verify_fin_mobile_capture.js']
if architecture:
    files += ['engine/ingestion/otlp_protobuf.js',
        'engine/investigation/request_investigation.js', 'engine/storage/trace_journal.js',
        'docs/31_Target_Architecture.md', 'docs/32_Implementation_Plan.md',
        'docs/33_Investigation_Implementation.md', 'tests/verify_investigation.js',
        'tests/verify_investigation_console.js', 'tests/verify_trace_journal.js']
if storage:
    files += ['engine/storage/storage_policy.js', 'docs/34_Storage_Recovery_D2.md',
        'tests/verify_storage_policy.js', 'tests/verify_storage_console.js']
if idempotency:
    files += ['engine/storage/observation_identity.js', 'engine/baseline_learner.js',
        'docs/35_Idempotent_Ingestion_D3.md', 'tests/verify_idempotent_ingestion.js',
        'tests/verify_idempotent_console.js']
if capacity:
    files += ['.env.example', 'docs/36_Local_Capacity_D4.md', 'tests/measure_repository_capacity.js']
out = root / 'artifacts/pilot'
baseline = json.loads((out / 'imported-baseline.json').read_text(encoding='utf-8-sig'))
hashes = {v['path'].replace('\\', '/'): v['sha256'].lower() for v in baseline}
patch, records = [], []
for name in files:
    old = source / name
    new = root / name
    old_bytes = old.read_bytes() if old.exists() else b''
    new_bytes = new.read_bytes()
    old_hash = hashlib.sha256(old_bytes).hexdigest() if old.exists() else None
    if name in hashes and old_hash != hashes[name]:
        raise RuntimeError(f'Authoritative source changed since import: {name}; review before packaging')
    if old_bytes == new_bytes:
        continue
    patch.extend(difflib.unified_diff(old_bytes.decode('utf-8-sig').splitlines(keepends=True),
        new_bytes.decode('utf-8-sig').splitlines(keepends=True),
        fromfile='a/' + name if old.exists() else '/dev/null', tofile='b/' + name))
    records.append({'path': name, 'baselineSha256': old_hash, 'sha256': hashlib.sha256(new_bytes).hexdigest(),
        'importHashVerified': name in hashes, 'newFile': not old.exists()})
review_out = root / 'artifacts/storage-d4' if capacity else root / 'artifacts/storage-d3' if idempotency else root / 'artifacts/storage-d2' if storage else root / 'artifacts/investigation' if architecture else root / 'artifacts/mobile-pilot' if mobile else out
(review_out / 'implementation.patch').write_text(''.join(patch), encoding='utf-8', newline='')
(review_out / 'implementation-files.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(f'Packaged {len(records)} pilot files; original checkout unchanged. Evidence artifacts remain alongside the patch.')
