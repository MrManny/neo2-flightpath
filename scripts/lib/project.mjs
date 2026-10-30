// Optional GitHub Projects status update shared by the scripts/ helpers.
// Best-effort by design: when the gh login cannot read or edit the project
// every step here fails softly and setIssueStatus() reports false, so the
// calling script can skip silently without treating it as an error.
import { execFileSync } from 'node:child_process';

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
}

// Moves the given issue's project item to the named Status option. Option and
// field ids are looked up at runtime because GitHub mints them per project.
// Returns true only when the status was actually updated.
export function setIssueStatus(issueNumber, optionName) {
  try {
    const owner = ghJson(['repo', 'view', '--json', 'owner']).owner.login;
    const projects = ghJson(['project', 'list', '--owner', owner, '--format', 'json']).projects;
    for (const project of projects) {
      const items = ghJson([
        'project', 'item-list', String(project.number), '--owner', owner, '--format', 'json',
      ]).items;
      const item = items.find((entry) => entry.content?.number === Number(issueNumber));
      if (!item) continue;
      const fields = ghJson([
        'project', 'field-list', String(project.number), '--owner', owner, '--format', 'json',
      ]).fields;
      const status = fields.find((field) => field.name === 'Status' && field.options);
      const option = status?.options.find((candidate) => candidate.name === optionName);
      if (!status || !option) return false;
      execFileSync('gh', [
        'project', 'item-edit',
        '--id', item.id,
        '--project-id', project.id,
        '--field-id', status.id,
        '--single-select-option-id', option.id,
      ]);
      return true;
    }
    return false;
  } catch {
    // No project access (or gh cannot see the repo) is not an error here.
    return false;
  }
}
