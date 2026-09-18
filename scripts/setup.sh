#!/bin/bash
# Retired unsafe legacy provisioning entry point. No provisioning workflow is available here.
builtin printf '%s\n' 'ERROR: unsafe legacy provisioning is retired.' 'This script changed no resources, secrets, configuration or seed data.' 'Safe desired-state provisioning remains pending W08 and decision D01; see docs/remediation/README.md.' >&2
exit 2
