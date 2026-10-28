#!/usr/bin/env bash
# Install the muse-code AppArmor profile. Run with: sudo bash install-apparmor.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 1; }
src="$(dirname "$(readlink -f "$0")")/muse-code.apparmor"
apparmor_parser -Q -K "$src"          # syntax check only, loads nothing
install -m 644 -o root -g root "$src" /etc/apparmor.d/muse-code
apparmor_parser -r /etc/apparmor.d/muse-code
grep -q '^muse-code ' /sys/kernel/security/apparmor/profiles && echo "OK: muse-code profile loaded"
