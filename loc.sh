#!/usr/bin/env bash
set -e

# Count lines of code across all repos, output JSON
# Usage: nix-shell -p cloc jq --run "bash loc.sh"
# Output: loc_report.json

REPOS=(
  "$HOME/git/front"
  "$HOME/git/cloud"
  "$HOME/git/unix"
  "$HOME/git/vault"
)

OUTDIR="$(cd "$(dirname "$0")" && pwd)"
OUTFILE="$OUTDIR/loc_report.json"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# --- 1. Per-repo LOC (cloc JSON, skip binaries) ---
for repo in "${REPOS[@]}"; do
  name=$(basename "$repo")
  cloc "$repo" --json --quiet \
    --exclude-dir=node_modules,dist,.git,.build,__pycache__,.mypy_cache \
    --not-match-f='\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|svg|mp3|mp4|webm|pdf|zip|tar|gz|db|sqlite|sqlite3)$' \
    2>/dev/null > "$TMPDIR/${name}.json" || true
done

# --- 2. Total LOC across all repos ---
cloc "${REPOS[@]}" --json --quiet \
  --exclude-dir=node_modules,dist,.git,.build,__pycache__,.mypy_cache \
  --not-match-f='\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|svg|mp3|mp4|webm|pdf|zip|tar|gz|db|sqlite|sqlite3)$' \
  2>/dev/null > "$TMPDIR/total.json" || true

# --- 3. Count database files by type ---
db_json="{"
first=true
for repo in "${REPOS[@]}"; do
  name=$(basename "$repo")
  sqlite_count=$(find "$repo" -type f \( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" \) 2>/dev/null | wc -l | tr -d ' ')
  json_db_count=$(find "$repo" -type f -name "*.json" -path "*/data/*" 2>/dev/null | wc -l | tr -d ' ')
  sql_count=$(find "$repo" -type f -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
  csv_count=$(find "$repo" -type f -name "*.csv" 2>/dev/null | wc -l | tr -d ' ')
  yaml_data_count=$(find "$repo" -type f \( -name "*.yml" -o -name "*.yaml" \) -path "*/data/*" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$first" = true ]; then first=false; else db_json+=","; fi
  db_json+="\"$name\":{\"sqlite\":$sqlite_count,\"sql\":$sql_count,\"csv\":$csv_count,\"json_data\":$json_db_count,\"yaml_data\":$yaml_data_count}"
done
db_json+="}"

# --- 4. Assemble final JSON ---
jq -n \
  --slurpfile total "$TMPDIR/total.json" \
  --slurpfile front "$TMPDIR/front.json" \
  --slurpfile cloud "$TMPDIR/cloud.json" \
  --slurpfile unix "$TMPDIR/unix.json" \
  --slurpfile vault "$TMPDIR/vault.json" \
  --argjson databases "$db_json" \
  '{
    total_all_repos: $total[0],
    per_repo: {
      front: $front[0],
      cloud: $cloud[0],
      unix: $unix[0],
      vault: $vault[0]
    },
    databases: $databases
  }' > "$OUTFILE"

echo "Report saved to: $OUTFILE"

# --- 5. Print summary ---
echo ""
echo "=== TOTAL LOC ==="
jq -r '.total_all_repos | to_entries[] | select(.key != "header") | "\(.key): \(.value.code) code, \(.value.blank) blank, \(.value.comment) comment"' "$OUTFILE" 2>/dev/null || true

echo ""
echo "=== PER REPO TOTALS ==="
for repo in front cloud unix vault; do
  code=$(jq -r ".per_repo.${repo}.SUM.code // 0" "$OUTFILE" 2>/dev/null)
  echo "  $repo: $code lines of code"
done

echo ""
echo "=== DATABASES ==="
jq -r '.databases | to_entries[] | "\(.key): sqlite=\(.value.sqlite) sql=\(.value.sql) csv=\(.value.csv) json_data=\(.value.json_data) yaml_data=\(.value.yaml_data)"' "$OUTFILE" 2>/dev/null || true
