#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" != /etc/letsencrypt/live/www.mdduck.com ]; then
    exit 0
fi
/www/server/nginx/sbin/nginx -t 2>&1
/www/server/nginx/sbin/nginx -s reload
