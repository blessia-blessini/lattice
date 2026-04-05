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
export interface SymbolInfo {
  char: string;
  name: string;
  keywords: string;
}

export const symbols: SymbolInfo[] = [
  // Arrows
  { char: '→', name: 'Right Arrow', keywords: 'arrow right' },
  { char: '←', name: 'Left Arrow', keywords: 'arrow left' },
  { char: '↑', name: 'Up Arrow', keywords: 'arrow up' },
  { char: '↓', name: 'Down Arrow', keywords: 'arrow down' },
  { char: '↔', name: 'Left-Right Arrow', keywords: 'arrow aleft right' },
  { char: '⇒', name: 'Right Double Arrow', keywords: 'arrow right double' },
  { char: '⇐', name: 'Left Double Arrow', keywords: 'arrow left double' },

  // Common
  { char: '©', name: 'Copyright', keywords: 'copyright' },
  { char: '®', name: 'Registered', keywords: 'registered trademark' },
  { char: '™', name: 'Trademark', keywords: 'tm trademark' },
  { char: '•', name: 'Bullet', keywords: 'bullet dot' },
  { char: '…', name: 'Ellipsis', keywords: 'ellipsis dots' },

  // Punctuation
  { char: '–', name: 'En Dash', keywords: 'dash en' },
  { char: '—', name: 'Em Dash', keywords: 'dash em' },

  // human signs 
  { char: '⚠️', name: 'Warning Sign', keywords: 'Exclamation mark warning' },
  { char: '🛑', name: 'Stop Sign Hexagram', keywords: 'stop sign halt' },
  { char: '✅', name: 'Check', keywords: 'Green check mark' },
  { char: '☑', name: 'Checked Box', keywords: 'check box checked square' },
  { char: '☐', name: 'Empty Box', keywords: 'check box empty square' },
  { char: '❌', name: 'Cross Fail', keywords: 'Check fail crosss sign' },
  { char: '❓', name: 'Red Question Mark', keywords: 'question mark red help' },
  { char: '❔', name: 'White Question Mark', keywords: 'question mark white help' },
  { char: '🟢', name: 'Green circle', keywords: 'semaphore, traffic light, green, go, agreed' },
  { char: '🟡', name: 'Yellow circle', keywords: 'at risk, yellow circle, not ok yet' },
  { char: '🔴', name: 'Red circle', keywords: 'High risk, red circle, not ok, stop light' },

  // Math
  { char: '≠', name: 'Not Equal To', keywords: 'math not equal' },
  { char: '≡', name: 'Identical To (Equivalent)', keywords: 'math equivalent identical' },
  { char: '≅', name: 'Approximately Equal (Congruent)', keywords: 'math congruent approximate' },
  { char: '≈', name: 'Almost Equal To', keywords: 'math almost equal' },
  { char: '≤', name: 'Less-Than or Equal', keywords: 'math less equal' },
  { char: '≥', name: 'Greater-Than or Equal', keywords: 'math greater equal' },
  { char: '±', name: 'Plus-Minus', keywords: 'math plus minus' },
  { char: '×', name: 'Multiplication (X)', keywords: 'math multiply times' },
  { char: '⋅', name: 'Multiplication (Dot)', keywords: 'math multiply times dot' },
  { char: '✕', name: 'Multiplication (Plain X)', keywords: 'math multiply times x' },
  { char: '÷', name: 'Division', keywords: 'math divide' },
  { char: '°', name: 'Degree', keywords: 'degree sign' },

  // Shapes
  { char: '■', name: 'Black Square', keywords: 'shape square black filled' },
  { char: '□', name: 'White Square', keywords: 'shape square white empty' },
  { char: '●', name: 'Black Circle', keywords: 'shape circle black filled' },
  { char: '○', name: 'White Circle', keywords: 'shape circle white empty' },
  { char: '▲', name: 'Black Triangle', keywords: 'shape triangle black filled' },
  { char: '▼', name: 'White Triangle', keywords: 'shape triangle white filled' },

  // Misc
  { char: '✓', name: 'Check Mark', keywords: 'check success done' },
  { char: '✗', name: 'Ballot X', keywords: 'x fail wrong' },
  { char: '★', name: 'Black Star', keywords: 'star favorite' },
  { char: '☆', name: 'White Star', keywords: 'star empty' },
  { char: '☰', name: 'Menu Icon', keywords: 'menu hamburger' },
  { char: '⌘', name: 'Command Key', keywords: 'mac command' },
];
