#!/usr/bin/env bash
set -eu
exec bash --noprofile --norc "$(dirname "$0")/provision-stamp.sh" staging "$@"
