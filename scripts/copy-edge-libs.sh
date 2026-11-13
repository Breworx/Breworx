#!/bin/sh
# The server-side Xero sync (supabase/functions/xero-sync) runs the same
# stock and order logic as the app. Run this after changing any of these
# files, then redeploy xero-sync.
set -e
cd "$(dirname "$0")/.."
dest=supabase/functions/xero-sync/lib
mkdir -p "$dest"
for f in production utils xeroOrders mappers; do
  sed -E 's#from "\./([A-Za-z]+)";#from "./\1.js";#' "src/lib/$f.js" > "$dest/$f.js"
done
echo "copied to $dest"
