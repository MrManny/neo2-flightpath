// Turns the raw messages from Node and the app backend into sentences a person
// can act on. The original text is kept for the technical details, and messages
// this table does not know pass through unchanged.

export interface ErrorText {
  /** The sentence to show first. */
  text: string;
  /** The original message when it was rewritten; null when shown as-is. */
  technical: string | null;
}

const NODE_CODE = /^(EEXIST|ENOENT|EACCES|EPERM|ENOSPC|EBUSY|EISDIR): /;

// Node names the offending path last, in single quotes: "..., mkdir 'C:\...'".
function quotedPath(message: string): string | null {
  const match = /'([^']+)'(?: -> '[^']*')?$/.exec(message);
  return match ? match[1] : null;
}

// Paths come from the main process on Windows, so both separators count.
function leafName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

interface NodeSentence {
  lead: (name: string | null) => string;
  advice: string;
}

const NODE_SENTENCES: Record<string, NodeSentence> = {
  EEXIST: {
    lead: (name) => (name ? `A file named "${name}" is in the way.` : 'A file is in the way.'),
    advice: 'Choose another folder or file name.',
  },
  ENOENT: {
    lead: (name) => (name ? `"${name}" was not found.` : 'The file or folder was not found.'),
    advice: 'Check that it still exists.',
  },
  EACCES: {
    lead: (name) => (name ? `Access to "${name}" was denied.` : 'Access was denied.'),
    advice: 'Choose a location you can write to.',
  },
  EPERM: {
    lead: (name) => (name ? `Access to "${name}" was denied.` : 'Access was denied.'),
    advice: 'Choose a location you can write to.',
  },
  ENOSPC: {
    lead: () => 'The disk is full.',
    advice: 'Free some space or choose another drive.',
  },
  EBUSY: {
    lead: (name) => (name ? `"${name}" is in use by another program.` : 'The file is in use by another program.'),
    advice: 'Close it and try again.',
  },
  EISDIR: {
    lead: (name) => (name ? `"${name}" is a folder, not a file.` : 'A folder is in the way.'),
    advice: 'Choose a different file name.',
  },
};

const APP_SENTENCES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
  [/^no recording loaded$/, () => 'No recording is loaded. Open a recording first.'],
  [/^an export is already running$/, () => 'An export is already running. Wait for it to finish or cancel it.'],
  [/^export could not start$/, () => 'The export could not start. Try again.'],
  [
    /^the output must not overwrite the source recording$/,
    () => 'The export would replace the source recording. Choose another file name.',
  ],
  [/^output path must be absolute: /, () => 'The export needs a full path to its destination.'],
  [/^app bridge unavailable$/, () => 'The app backend is not available. Restart the app.'],
  [/^render canceled$/, () => 'The export was canceled.'],
  [/^not a readable \.mp4 file: (.+)$/, (m) => `"${leafName(m[1])}" is not a readable .mp4 recording.`],
  [
    /^output verification failed: /,
    () => 'The finished file does not match the recording frame count or frame rate.',
  ],
  [
    /^could not replace .*\(the finished render is at (.+)\)$/,
    (m) =>
      `The export finished, but its file could not replace the destination. The render is kept at ${m[1]}.`,
  ],
  [/^could not determine the frame rate of the video$/, () => "This video's frame rate could not be read."],
  [/^unknown error$/, () => 'Something went wrong. Try again.'],
];

export function describeError(message: string): ErrorText {
  const node = NODE_CODE.exec(message);
  if (node) {
    const sentence = NODE_SENTENCES[node[1]];
    const path = quotedPath(message);
    const name = path === null ? null : leafName(path);
    return { text: `${sentence.lead(name)} ${sentence.advice}`, technical: message };
  }
  for (const [pattern, render] of APP_SENTENCES) {
    const match = pattern.exec(message);
    if (match) return { text: render(match), technical: message };
  }
  return { text: message, technical: null };
}
