#!/usr/bin/env bash
# Explicit customer target; no ambient config or automatic secret generation.
set -eu
if [ "$#" -lt 1 ]; then
  builtin printf '%s\n' 'Require staging|production and protected workflow arguments.' >&2
  exit 2
fi
case "$1" in staging|production) stamp_environment=$1 ;; *) exit 2 ;; esac
shift
exec node "$(dirname "$0")/stamp-workflow.mjs" --environment "$stamp_environment" "$@"
