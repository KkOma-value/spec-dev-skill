import json, re, os
from collections import Counter

cmds = Counter()
mcp_calls = Counter()

with open(os.path.expanduser('~/.claude/projects/transcripts.txt'), 'r') as f:
    paths = [line.strip() for line in f if line.strip()]

for path in paths:
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
            for line in fh:
                try:
                    obj = json.loads(line)
                    if obj.get('role') != 'assistant':
                        continue
                    for item in obj.get('message', {}).get('content', []):
                        if item.get('type') != 'tool_use':
                            continue
                        name = item.get('name', '')
                        if name == 'Bash':
                            cmd = item.get('input', {}).get('command', '')
                            if 'subagents' in cmd and '.jsonl' in cmd:
                                continue
                            cmd = cmd.strip()
                            cmd = re.sub(r'^[A-Z_]+=\S+\s+', '', cmd)
                            cmd = re.sub(r'^timeout\s+\d+\s+', '', cmd)
                            cmd = re.sub(r'^sudo\s+', '', cmd)
                            parts = cmd.split(None, 1)
                            if not parts:
                                continue
                            base = parts[0]
                            if base in ('git','gh','docker','mvn','npm','pnpm','bun','yarn','kubectl','powershell','adb','java','javac') and len(parts) > 1:
                                sub = parts[1].split(None, 1)[0]
                                key = f'{base} {sub}'
                            else:
                                key = base
                            cmds[key] += 1
                        elif name.startswith('mcp__'):
                            mcp_calls[name] += 1
                except:
                    continue
    except Exception as e:
        pass

print('=== Bash Commands ===')
for cmd, count in cmds.most_common(60):
    print(f'{count:4d}  {cmd}')

print()
print('=== MCP Calls ===')
for cmd, count in mcp_calls.most_common(30):
    print(f'{count:4d}  {cmd}')
