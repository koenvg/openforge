function appendFlagValue(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }
  flags[key] = [flags[key], value];
}

function flagName(name) {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required flag ${flagName(name)}`);
  }
  return value;
}

export function optionalString(flags, name) {
  return typeof flags[name] === 'string' ? flags[name] : undefined;
}

export function stringListFromFlag(flags, name) {
  const raw = flags[name];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
  }
  return result;
}

function tokensMatch(argv, tokens) {
  if (argv.length < tokens.length) return false;
  return tokens.every((token, index) => argv[index] === token);
}

function resolveCommand(argv, commandSpecs) {
  const commandMatches = commandSpecs.map((spec) => ({
    spec,
    tokens: spec.path,
  })).sort((left, right) => right.tokens.length - left.tokens.length);

  for (const match of commandMatches) {
    if (tokensMatch(argv, match.tokens)) {
      return {
        spec: match.spec,
        commandName: match.tokens.join(' '),
        rest: argv.slice(match.tokens.length),
      };
    }
  }
  return null;
}

function parseFlags(rest) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      appendFlagValue(flags, key, true);
      continue;
    }

    appendFlagValue(flags, key, next);
    i += 1;
  }

  return { flags, positionals };
}

function shouldPrintHelpArg(argv) {
  return argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h';
}

function shouldPrintCommandHelp(flags) {
  return flags.help === true;
}

function validateSupportedFlags(commandName, supportedFlags, flags) {
  for (const name of Object.keys(flags)) {
    if (name === 'help') continue;
    if (!supportedFlags.has(name)) {
      throw new Error(`${commandName} does not support ${flagName(name)}`);
    }
  }
}

export async function runCommandLine(argv, commandSpecs, help) {
  if (shouldPrintHelpArg(argv)) {
    help.printHelp(commandSpecs);
    return;
  }

  const resolved = resolveCommand(argv, commandSpecs);
  if (!resolved) {
    throw new Error(`unknown command: ${argv[0]}`);
  }

  const { spec, commandName, rest } = resolved;
  const { flags, positionals } = parseFlags(rest);

  if (shouldPrintCommandHelp(flags)) {
    help.printCommandHelp(spec);
    return;
  }

  validateSupportedFlags(commandName, new Set(spec.flags), flags);
  spec.validate?.(flags, positionals);
  if (positionals.length > 0 && !spec.allowPositionals) {
    throw new Error(`unexpected positional argument: ${positionals[0]}`);
  }

  await spec.handler(flags, positionals);
}
