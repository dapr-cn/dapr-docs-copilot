const OUTPUT_LOCALE_ALIAS_PREFIXES: Record<string, string> = {
  zh_CN: '/zh-hans/',
}

export function resolveAliasPrefixForTargetPath(targetPath: string): string | null {
  const normalizedTargetPath = targetPath.replace(/\\/g, '/')
  const pathParts = normalizedTargetPath.split('/')
  const translatedContentIndex = pathParts.indexOf('translated_content')
  if (translatedContentIndex === -1) {
    return null
  }

  const outputLocale = pathParts[translatedContentIndex + 1]
  if (!outputLocale) {
    return null
  }

  return OUTPUT_LOCALE_ALIAS_PREFIXES[outputLocale] ?? null
}

function isSiteRelativeAliasPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

function hasAliasPrefix(value: string, aliasPrefix: string): boolean {
  const normalizedPrefix = aliasPrefix.endsWith('/') ? aliasPrefix.slice(0, -1) : aliasPrefix
  return value === normalizedPrefix || value.startsWith(aliasPrefix)
}

function normalizeAliasPath(value: string, aliasPrefix: string): string {
  if (!isSiteRelativeAliasPath(value) || hasAliasPrefix(value, aliasPrefix)) {
    return value
  }

  const normalizedPrefix = aliasPrefix.endsWith('/') ? aliasPrefix.slice(0, -1) : aliasPrefix
  return `${normalizedPrefix}/${value.replace(/^\/+/, '')}`
}

function normalizeAliasScalar(rawValue: string, aliasPrefix: string): string {
  const leadingWhitespace = rawValue.match(/^\s*/)?.[0] ?? ''
  const trailingWhitespace = rawValue.match(/\s*$/)?.[0] ?? ''
  const trimmedValue = rawValue.trim()
  if (!trimmedValue) {
    return rawValue
  }

  const singleQuoted = trimmedValue.startsWith("'") && trimmedValue.endsWith("'")
  const doubleQuoted = trimmedValue.startsWith('"') && trimmedValue.endsWith('"')
  const quote = singleQuoted ? "'" : doubleQuoted ? '"' : ''
  const value = quote ? trimmedValue.slice(1, -1) : trimmedValue
  const normalizedValue = normalizeAliasPath(value, aliasPrefix)
  if (normalizedValue === value) {
    return rawValue
  }

  return `${leadingWhitespace}${quote}${normalizedValue}${quote}${trailingWhitespace}`
}

function normalizeInlineAliases(line: string, aliasPrefix: string): string {
  const match = line.match(/^(\s*aliases:\s*\[)(.*)(\]\s*(?:#.*)?)$/)
  if (!match) {
    return line
  }

  const [, prefix, content, suffix] = match
  const entries: string[] = []
  let current = ''
  let activeQuote: '"' | "'" | null = null

  for (const character of content) {
    if (activeQuote) {
      current += character
      if (character === activeQuote) {
        activeQuote = null
      }
      continue
    }

    if (character === '"' || character === "'") {
      activeQuote = character
      current += character
      continue
    }

    if (character === ',') {
      entries.push(current)
      current = ''
      continue
    }

    current += character
  }

  if (activeQuote) {
    return line
  }

  entries.push(current)
  const normalizedEntries = entries.map((entry) => normalizeAliasScalar(entry, aliasPrefix))
  const normalizedLine = `${prefix}${normalizedEntries.join(',')}${suffix}`
  return normalizedLine === line ? line : normalizedLine
}

function normalizeAliasListItem(line: string, aliasPrefix: string): string {
  const match = line.match(/^(\s*-\s*)(?:"([^"]*)"|'([^']*)'|([^#\r\n]+?))(\s*(?:#.*)?)$/)
  if (!match) {
    return line
  }

  const [, prefix, doubleQuotedValue, singleQuotedValue, plainValue, suffix = ''] = match
  const quote = doubleQuotedValue !== undefined ? '"' : singleQuotedValue !== undefined ? "'" : ''
  const value = (doubleQuotedValue ?? singleQuotedValue ?? plainValue ?? '').trim()
  const normalizedValue = normalizeAliasPath(value, aliasPrefix)
  if (normalizedValue === value) {
    return line
  }

  return `${prefix}${quote}${normalizedValue}${quote}${suffix}`
}

export function normalizeMarkdownAliases(text: string, targetPath: string): string {
  const aliasPrefix = resolveAliasPrefixForTargetPath(targetPath)
  if (!aliasPrefix) {
    return text
  }

  const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n|$)/)
  if (!match) {
    return text
  }

  const [, frontMatterStart, frontMatterBody, frontMatterEnd, separator] = match
  const newline = frontMatterStart.includes('\r\n') || frontMatterBody.includes('\r\n') || frontMatterEnd.includes('\r\n') ? '\r\n' : '\n'
  const lines = frontMatterBody.split(/\r?\n/)
  let changed = false

  for (let index = 0; index < lines.length; index += 1) {
    const inlineNormalized = normalizeInlineAliases(lines[index], aliasPrefix)
    if (inlineNormalized !== lines[index]) {
      lines[index] = inlineNormalized
      changed = true
      continue
    }

    const aliasesLine = lines[index].match(/^(\s*)aliases:\s*$/)
    if (!aliasesLine) {
      continue
    }

    const baseIndent = aliasesLine[1].length
    for (let innerIndex = index + 1; innerIndex < lines.length; innerIndex += 1) {
      const currentLine = lines[innerIndex]
      if (!currentLine.trim()) {
        continue
      }

      const currentIndent = currentLine.match(/^(\s*)/)?.[1].length ?? 0
      if (currentIndent <= baseIndent) {
        break
      }

      const normalizedLine = normalizeAliasListItem(currentLine, aliasPrefix)
      if (normalizedLine !== currentLine) {
        lines[innerIndex] = normalizedLine
        changed = true
      }
    }
  }

  if (!changed) {
    return text
  }

  return `${frontMatterStart}${lines.join(newline)}${frontMatterEnd}${separator}${text.slice(match[0].length)}`
}
