#!/bin/bash
# LEGAL NOTE:
# LATTICE (tm) - The Portable and standard Markdown Editor
# Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
# email: blessia AT blessini.com
#
# GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# See LICENCE file in GitHUB root folder of the repository.
# END OF NOTE

echo ""
echo "   ***********************************************"
echo "   ****** Building changelog-update utility ******"
echo "   Building changelog-update... on posix system"
cargo build --release

echo "   ***********************************************"
echo "   Running changelog-update tests ..."
cargo test
if [ $? -ne 0 ]; then
    echo "[ERROR] changelog-update tests failed — aborting setup."
    exit 1
fi
echo "   Tests passed OK"
echo "   ***********************************************"

echo "   Copying to the root of the utility"
cp target/release/changelog-update .
chmod +x changelog-update
echo "   Utility build complete"
echo "   ****** END Building changelog-update utility **"
echo "   ***********************************************"
echo ""
