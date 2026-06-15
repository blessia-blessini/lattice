// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

// E2E build configuration — used by `npm run build:e2e_test`.
//
// Passing `true` to makeViteConfig is the TypeScript equivalent of passing
// `--cfg e2e_test` to rustc: IS_E2E_TST_BUILD is baked as `true` in the
// bundle and StaticRuntime.dev.ts is selected so setupTestModeListeners runs.
//
// The production build (npm run build) uses vite.config.ts with false.
// No env-var reading; the config file name is the explicit flag.
import { makeViteConfig } from './vite.config';

export default makeViteConfig(true);
