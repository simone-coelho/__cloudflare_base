import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  deriveStatus,
  makeDraftProgram,
  makeReceiptTemplate,
  parseTicketIds,
  renderWorkOrder,
  validateProgram,
  workOrderHash,
} from './core.mjs';

const HELP = `Closure Ledger

Usage:
  closure-ledger init --dir <directory> --ids <T01-T26> --program-id <id> --title <title>
  closure-ledger check --program <program.json> [--receipts <directory>] [--json]
  closure-ledger status --program <program.json> [--receipts <directory>] [--json]
  closure-ledger next --program <program.json> [--receipts <directory>] [--json]
  closure-ledger hash <ticket-id> --program <program.json>
  closure-ledger render <ticket-id> --program <program.json>
  closure-ledger receipt-template <ticket-id> --program <program.json> [--kind DELIVERY|ADOPTION] [--out <file>]

Commands:
  init              Safely creates a draft program. The draft intentionally fails check until all TBD values are replaced.
  check             Validates the frozen denominator, work orders, optional receipts, and sequence rules.
  status            Derives local and final completion only from valid receipts.
  next              Prints the first ticket that is not locally done. It never skips a blocked ticket.
  hash              Prints the current frozen work-order hash for one ticket.
  render            Renders one validated work order as Markdown to stdout.
  receipt-template  Produces a fail-closed receipt template pinned to the current work-order hash.

Options:
  --json            Emit machine-readable JSON where supported.
  --help            Show this help.
`;

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (['json', 'help'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`option --${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return { positionals, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`missing required option --${name}`);
  return value;
}

function readJson(path) {
  const absolute = resolve(path);
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  }
  catch (error) {
    throw new Error(`cannot read ${absolute}: ${error.message}`);
  }
  try {
    return { absolute, value: JSON.parse(text) };
  }
  catch (error) {
    throw new Error(`invalid JSON in ${absolute}: ${error.message}`);
  }
}

function readReceipts(path) {
  const absolute = resolve(path);
  const receipts = new Map();
  const errors = [];
  if (!existsSync(absolute)) return { absolute, receipts, errors };
  if (!statSync(absolute).isDirectory()) {
    return { absolute, receipts, errors: [{ path: absolute, message: 'receipt path is not a directory' }] };
  }
  for (const name of readdirSync(absolute).filter(entry => entry.endsWith('.json')).sort()) {
    const file = resolve(absolute, name);
    try {
      const receipt = JSON.parse(readFileSync(file, 'utf8'));
      const ticketId = receipt?.ticketId;
      if (typeof ticketId !== 'string' || ticketId.trim().length === 0) {
        errors.push({ path: file, message: 'receipt has no ticketId' });
        continue;
      }
      if (receipts.has(ticketId)) {
        errors.push({ path: file, message: `duplicates receipt for ${ticketId}` });
        continue;
      }
      receipts.set(ticketId, receipt);
    }
    catch (error) {
      errors.push({ path: file, message: `invalid JSON: ${error.message}` });
    }
  }
  return { absolute, receipts, errors };
}

function defaultReceiptsPath(programPath) {
  return resolve(dirname(resolve(programPath)), 'receipts');
}

function formatErrors(errors) {
  return errors.map(error => `- ${error.path}: ${error.message}`).join('\n');
}

function printValidationFailure(errors, json) {
  if (json) process.stdout.write(`${JSON.stringify({ valid: false, errors }, null, 2)}\n`);
  else process.stderr.write(`FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})\n${formatErrors(errors)}\n`);
}

function statusPayload(document, programPath, receiptsPath) {
  const receiptRead = readReceipts(receiptsPath ?? defaultReceiptsPath(programPath));
  const status = deriveStatus(document, receiptRead.receipts);
  const errors = [...receiptRead.errors, ...status.errors];
  return {
    valid: errors.length === 0,
    program: {
      id: document?.program?.id,
      title: document?.program?.title,
      path: resolve(programPath),
      receipts: receiptRead.absolute,
    },
    summary: status.summary,
    next: status.next,
    tickets: status.tickets,
    errors,
  };
}

function formatStatus(payload) {
  const summary = payload.summary;
  const lines = [
    `Program: ${payload.program.title} (${payload.program.id})`,
    `Local done: ${summary?.localDone ?? 0}/${summary?.total ?? 0}`,
    `Final accepted: ${summary?.finalDone ?? 0}/${summary?.total ?? 0}`,
    `Deferred live pending: ${summary?.deferredPendingTickets ?? 0} ticket(s)`,
    `Next: ${payload.next ? `${payload.next.id} [${payload.next.state}]` : 'none — every ticket is locally done'}`,
    '',
    'Ticket\tState\tLive pending\tArtifact',
  ];
  for (const ticket of payload.tickets) {
    lines.push(`${ticket.id}\t${ticket.state}\t${ticket.deferredPending}\t${ticket.artifactRevision ?? '—'}`);
  }
  if (payload.errors.length > 0) lines.push('', `Errors (${payload.errors.length})`, formatErrors(payload.errors));
  return `${lines.join('\n')}\n`;
}

function commandInit(options) {
  const target = resolve(requireOption(options, 'dir'));
  const ticketIds = parseTicketIds(requireOption(options, 'ids'));
  const programId = requireOption(options, 'program-id');
  const title = requireOption(options, 'title');

  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new Error(`target exists and is not a directory: ${target}`);
    if (readdirSync(target).length > 0) throw new Error(`target directory is not empty: ${target}`);
  }
  else {
    mkdirSync(target, { recursive: true });
  }
  mkdirSync(resolve(target, 'receipts'), { recursive: true });
  const draft = makeDraftProgram({ id: programId, title, ticketIds });
  writeFileSync(resolve(target, 'program.json'), `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(
    resolve(target, 'README.md'),
    `# ${title}\n\nThis instance was created by Closure Ledger. Replace every \`TBD\` value in \`program.json\`, then run:\n\n\`\`\`bash\nclosure-ledger check --program ./program.json\n\`\`\`\n\nDo not begin delivery until the check passes. Completion is derived from receipts in \`receipts/\`.\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`Created draft program with ${ticketIds.length} frozen ticket ids at ${target}\n`);
  process.stdout.write('The draft is intentionally invalid until every TBD value is replaced.\n');
  return 0;
}

function commandCheck(options) {
  const programPath = requireOption(options, 'program');
  const { value: document, absolute } = readJson(programPath);
  const programValidation = validateProgram(document);
  if (!programValidation.valid) {
    printValidationFailure(programValidation.errors, options.json);
    return 1;
  }
  if (options.receipts) {
    const payload = statusPayload(document, absolute, options.receipts);
    if (!payload.valid) {
      printValidationFailure(payload.errors, options.json);
      return 1;
    }
  }
  const result = {
    valid: true,
    program: document.program.id,
    tickets: document.program.ticketIds.length,
    maxActive: document.program.maxActive,
    denominator: [...document.program.ticketIds],
  };
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`PASS: ${result.program} has exactly ${result.tickets} frozen tickets and maxActive=1.\n`);
  return 0;
}

function commandStatus(options) {
  const programPath = requireOption(options, 'program');
  const { value: document, absolute } = readJson(programPath);
  const payload = statusPayload(document, absolute, options.receipts);
  if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(formatStatus(payload));
  return payload.valid ? 0 : 1;
}

function commandNext(options) {
  const programPath = requireOption(options, 'program');
  const { value: document, absolute } = readJson(programPath);
  const payload = statusPayload(document, absolute, options.receipts);
  if (!payload.valid) {
    printValidationFailure(payload.errors, options.json);
    return 1;
  }
  const result = payload.next
    ? {
        done: false,
        ticketId: payload.next.id,
        state: payload.next.state,
        blocked: payload.next.state === 'BLOCKED',
      }
    : { done: true, ticketId: null, state: null, blocked: false };
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.done) process.stdout.write('All tickets are locally done.\n');
  else process.stdout.write(`${result.ticketId} [${result.state}]${result.blocked ? ' — do not skip' : ''}\n`);
  return 0;
}

function commandHash(positionals, options) {
  const ticketId = positionals[0];
  if (!ticketId) throw new Error('hash requires a ticket id');
  const { value: document } = readJson(requireOption(options, 'program'));
  const validation = validateProgram(document);
  if (!validation.valid) {
    printValidationFailure(validation.errors, false);
    return 1;
  }
  process.stdout.write(`${workOrderHash(document, ticketId)}\n`);
  return 0;
}

function commandRender(positionals, options) {
  const ticketId = positionals[0];
  if (!ticketId) throw new Error('render requires a ticket id');
  const { value: document } = readJson(requireOption(options, 'program'));
  process.stdout.write(`${renderWorkOrder(document, ticketId)}\n`);
  return 0;
}

function commandReceiptTemplate(positionals, options) {
  const ticketId = positionals[0];
  if (!ticketId) throw new Error('receipt-template requires a ticket id');
  const { value: document } = readJson(requireOption(options, 'program'));
  const kind = options.kind ?? 'DELIVERY';
  const template = `${JSON.stringify(makeReceiptTemplate(document, ticketId, kind), null, 2)}\n`;
  if (!options.out) {
    process.stdout.write(template);
    return 0;
  }
  const output = resolve(options.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, template, { flag: 'wx' });
  process.stdout.write(`Created ${output}; replace every REPLACE_WITH value before validation.\n`);
  return 0;
}

export function main(argv) {
  try {
    if (argv.length === 0 || argv.includes('--help') || argv[0] === 'help') {
      process.stdout.write(HELP);
      return 0;
    }
    const command = argv[0];
    const { positionals, options } = parseArguments(argv.slice(1));
    switch (command) {
      case 'init': return commandInit(options);
      case 'check': return commandCheck(options);
      case 'status': return commandStatus(options);
      case 'next': return commandNext(options);
      case 'hash': return commandHash(positionals, options);
      case 'render': return commandRender(positionals, options);
      case 'receipt-template': return commandReceiptTemplate(positionals, options);
      default:
        throw new Error(`unknown command: ${command}\n\n${HELP}`);
    }
  }
  catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    return 1;
  }
}
