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
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface FileResponse {
  content: string;
  hash: string;
}

export interface WriteResponse {
  path: string;
  hash: string;
}

export const FileSystem = {
  readTextFile: async (path: string): Promise<FileResponse> => {
    const label = getCurrentWebviewWindow().label;
    return await invoke('read_text_file', { path, window_label: label });
  },
  writeTextFile: async (path: string, content: string): Promise<WriteResponse> => {
    return await invoke('write_text_file', { path, content });
  },
  watchFile: async (path: string): Promise<void> => {
    return await invoke('watch_file', { path });
  },
  findVaultSettingsFile: async (filePath: string): Promise<string | null> => {
    return await invoke('find_vault_settings_file', { filePath }); //find_vault_path
  },
  initVaultSettingsPath: async (filePath: string): Promise<string> => {
    return await invoke('initialize_vault_settings', { filePath });
  },
  saveImage: async (filePath: string, imageData: string): Promise<string> => {
    return await invoke('save_image', { filePath, imageData });
  },
  isDir: async (path: string): Promise<boolean> => {
    return await invoke('is_dir', { path });
  }
};
