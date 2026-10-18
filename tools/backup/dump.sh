#!/usr/bin/env bash
# Data-only dump of the linked Supabase project, gzipped, to a folder OUTSIDE the repository.
# The dump holds personal data (names, birth dates of minors, auth.users with password hashes): it
# never goes into git, and this script prints only the file name and size, never any rows.
#   tools/backup/dump.sh [target-folder]      default: $HOME/ilca-backups
# Needs Docker running (the CLI runs pg_dump in a container), the Supabase CLI logged in and the repo linked (npx -y supabase@2.121.0 link --project-ref <ref>).
# Restore drill and retention: docs/operations.md, "Backups".
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
target=${1:-$HOME/ilca-backups}
case $target in /*) ;; *) target=$PWD/$target ;; esac   # absolute first, so the repo check below sees it

# Check before creating anything: resolve the target through its nearest existing parent.
probe=$target
while [ ! -d "$probe" ]; do probe=$(dirname -- "$probe"); done
resolved="$(cd -- "$probe" && pwd -P)${target#"$probe"}"
case "$resolved/" in
  "$repo"/*) echo "refusing: $target is inside the repository ($repo); choose a folder outside it" >&2; exit 1 ;;
esac

umask 077   # the dump is readable by its owner only
mkdir -p -- "$target"
target=$(cd -- "$target" && pwd -P)
case "$target/" in
  "$repo"/*) echo "refusing: $target is inside the repository ($repo); choose a folder outside it" >&2; exit 1 ;;
esac

out="$target/ilca-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
tmp="$out.partial"
sql=$(mktemp -p "$target" .dump-XXXXXX)
trap 'rm -f -- "$tmp" "$sql"' EXIT

cd "$repo"
# The CLI writes the dump to a file (-f), so no row reaches the terminal.
npx -y supabase@2.121.0 db dump --linked --data-only -f "$sql" >/dev/null
gzip -c -- "$sql" > "$tmp"
mv -- "$tmp" "$out"
echo "$out ($(du -h -- "$out" | cut -f1))"
