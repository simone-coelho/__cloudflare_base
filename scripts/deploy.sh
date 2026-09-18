#!/usr/bin/env bash
# npm deploy uses this guarded artifact workflow; no rebuild or default target.
set -eu
if [ "$#" -lt 1 ]; then
  builtin printf '%s\n' 'Require staging|production and protected artifact workflow arguments.' >&2
  exit 2
fi
case "$1" in staging|production) stamp_environment=$1 ;; *) exit 2 ;; esac
shift
exec node "$(dirname "$0")/stamp-workflow.mjs" --environment "$stamp_environment" "$@"
