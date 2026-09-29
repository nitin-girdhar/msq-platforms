"""Generate the database diagrams from the DDL.

    python docs/tools/gen_db_diagram.py

Reads the CREATE TABLE statements in db_scripts/02_tables_core.sql and
03_tables_product.sql (the schema's single source of truth) and writes:

  * docs/db-schema-atlas.html -- interactive diagram: every table, column and
    foreign key, grouped by schema, with search and per-table detail.
  * the block between the GENERATED markers in docs/DB_model.md -- a schema
    overview plus one Mermaid ER diagram per schema (key columns only).

Table descriptions and column notes are read back out of docs/DB_model.md, so
keep writing those there. Re-run after any change to 02/03; the output is
deterministic, so an unchanged schema gives no diff. Standard library only.
"""
import json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
DDL_FILES = ['db_scripts/02_tables_core.sql', 'db_scripts/03_tables_product.sql', 'db_scripts/09_schema_version.sql']
DOC = os.path.join(REPO, 'docs', 'DB_model.md')
TEMPLATE = os.path.join(HERE, 'schema_atlas.template.html')
ATLAS = os.path.join(REPO, 'docs', 'db-schema-atlas.html')
BEGIN, END = '<!-- BEGIN GENERATED: gen_db_diagram.py -->', '<!-- END GENERATED: gen_db_diagram.py -->'

# Links the model relies on that are not declared as FOREIGN KEYs (text/bigint
# natural keys). Drawn dashed. Keep in step with DB_model.md.
LOGICAL = [
    ('entity.catalog_defaults', 'catalog_key', 'entity.catalog_versions', 'catalog_key'),
    ('entity.tenant_catalog_versions', 'catalog_key', 'entity.catalog_versions', 'catalog_key'),
    ('ext.meta_campaigns', 'ad_account_id', 'ext.meta_ad_accounts', 'ad_account_id'),
    ('ext.meta_adsets', 'meta_campaign_id', 'ext.meta_campaigns', 'meta_campaign_id'),
    ('ext.meta_ads', 'meta_adset_id', 'ext.meta_adsets', 'meta_adset_id'),
    ('ext.meta_ads', 'meta_campaign_id', 'ext.meta_campaigns', 'meta_campaign_id'),
]
SCHEMA_ORDER = ['entity', 'iam', 'geo', 'lms', 'marketing', 'ext', 'hr', 'task', 'audit', 'comms', 'notify', 'scratch', 'public']
TENANCY = {'entity.organizations', 'entity.tenants'}
STOP = {'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'REFERENCES', 'UNIQUE', 'CHECK', 'GENERATED', 'CONSTRAINT', 'COLLATE'}


# ---------------------------------------------------------------- DDL parser
def strip_comments(sql):
    out, i, n, q = [], 0, len(sql), False
    while i < n:
        ch = sql[i]
        if q:
            out.append(ch); q = ch != "'"; i += 1; continue
        if ch == "'": q = True
        elif sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j < 0 else j; continue
        elif sql.startswith('/*', i):
            j = sql.find('*/', i); i = n if j < 0 else j + 2; continue
        out.append(ch); i += 1
    return ''.join(out)


def split_top(body):
    parts, depth, cur, q = [], 0, [], False
    for ch in body:
        if q:
            cur.append(ch); q = ch != "'"; continue
        if ch == "'": q = True
        elif ch == '(': depth += 1
        elif ch == ')': depth -= 1
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur).strip()); cur = []; continue
        cur.append(ch)
    if ''.join(cur).strip(): parts.append(''.join(cur).strip())
    return parts


def cols_list(s):
    return [c.strip().strip('"') for c in s.split(',')]


def on_delete(s):
    m = re.search(r'ON DELETE (CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION)', s, re.I)
    return m.group(1).upper() if m else ''


def parse_ddl():
    tables = {}
    for rel in DDL_FILES:
        raw = strip_comments(open(os.path.join(REPO, rel), encoding='utf-8').read())
        for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\.([a-z_]+)\s*\(', raw, re.I):
            i, depth, q = m.end(), 1, False
            while depth:
                ch = raw[i]
                if ch == "'": q = not q
                elif not q and ch == '(': depth += 1
                elif not q and ch == ')': depth -= 1
                i += 1
            t = {'schema': m.group(1), 'name': m.group(2), 'cols': [], 'pk': [], 'uniques': [], 'fks': []}
            for item in split_top(raw[m.end():i - 1]):
                flat = re.sub(r'\s+', ' ', item).strip()
                cm = re.match(r'CONSTRAINT \S+ (.*)', flat, re.I)
                core = cm.group(1) if cm else flat
                cu = core.upper()
                if cu.startswith('PRIMARY KEY'):
                    t['pk'] = cols_list(re.search(r'\((.*?)\)', core).group(1))
                elif cu.startswith('UNIQUE'):
                    mm = re.search(r'\((.*?)\)', core)
                    if mm: t['uniques'].append(cols_list(mm.group(1)))
                elif cu.startswith('FOREIGN KEY'):
                    mm = re.match(r'FOREIGN KEY \((.*?)\) REFERENCES ([a-z_]+\.[a-z_]+) ?\((.*?)\)(.*)', core, re.I)
                    t['fks'].append({'cols': cols_list(mm.group(1)), 'ref': mm.group(2),
                                     'refcols': cols_list(mm.group(3)), 'on_delete': on_delete(mm.group(4))})
                elif cu.startswith(('CHECK', 'EXCLUDE')):
                    pass
                else:
                    toks = flat.split(' ')
                    name, ty = toks[0].strip('"'), []
                    for tok in toks[1:]:
                        if tok.upper() in STOP: break
                        ty.append(tok)
                    typ = ' '.join(ty)
                    rest = flat[len(toks[0]) + 1 + len(typ):].strip()
                    ru = rest.upper()
                    col = {'n': name, 't': typ.upper().replace('TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ'),
                           'nn': 'NOT NULL' in ru or 'PRIMARY KEY' in ru}
                    if 'PRIMARY KEY' in ru: t['pk'] = [name]
                    if re.search(r'\bUNIQUE\b', ru): t['uniques'].append([name])
                    rm = re.search(r'REFERENCES ([a-z_]+\.[a-z_]+) ?\((\w+)\)(.*)', rest, re.I)
                    if rm:
                        t['fks'].append({'cols': [name], 'ref': rm.group(1), 'refcols': [rm.group(2)],
                                         'on_delete': on_delete(rm.group(3))})
                    t['cols'].append(col)
            tables[f"{t['schema']}.{t['name']}"] = t
    return tables


def schema_version():
    raw = open(os.path.join(REPO, 'db_scripts/09_schema_version.sql'), encoding='utf-8').read()
    vs = re.findall(r"\('(\d+)\.(\d+)\.(\d+)'", raw)
    return '.'.join(max(vs, key=lambda v: tuple(map(int, v))))


# --------------------------------------------------- descriptions from the doc
def parse_doc(known):
    """First paragraph under each table heading, and each column's notes cell."""
    lines = open(DOC, encoding='utf-8').read().split('\n')
    desc, notes, targets = {}, {}, []
    for i, ln in enumerate(lines):
        if ln.startswith('#'):
            h = ln.lstrip('#').strip().split(' (')[0]
            targets = [k for k in re.findall(r'[a-z_]+\.[a-z_]+', h) if k in known]
            if len(targets) == 1:
                j = i + 1
                while j < len(lines) and not lines[j].strip(): j += 1
                if j < len(lines) and not lines[j].startswith(('|', '#', '<!--')):
                    desc.setdefault(targets[0], lines[j])
            continue
        m = re.match(r'^\*\*`?([a-z_]+\.[a-z_]+)`?\*\*\s*—?\s*(.*)', ln)
        if m and m.group(1) in known:
            targets = [m.group(1)]
            if m.group(2): desc.setdefault(m.group(1), m.group(2))
            continue
        if ln.startswith('|') and targets and not re.match(r'^\|\s*(Column|-)', ln):
            cells = [c.strip() for c in ln.strip().strip('|').split('|')]
            if len(cells) >= 3:
                for n in re.split(r'\s*/\s*', cells[0].replace('`', '')):
                    for key in targets:
                        notes.setdefault(key, {}).setdefault(n.strip(), ' | '.join(cells[2:]))
    clean = lambda s: re.sub(r'\s+', ' ', re.sub(r'[*`]', '', s)).strip()
    return {k: clean(v)[:280] for k, v in desc.items()}, {k: {c: clean(n) for c, n in v.items()} for k, v in notes.items()}


# ------------------------------------------------------------------ the model
def links_of(tables):
    """One link per FK, drawn on its non-tenant column (composite (tenant_id, x) FKs)."""
    out = []
    for key, t in tables.items():
        for f in t['fks']:
            pairs = list(zip(f['cols'], f['refcols']))
            if len(pairs) > 1:
                pairs = [p for p in pairs if p[0] != 'tenant_id'] or pairs[:1]
            for col, refcol in pairs:
                out.append({'from': key, 'col': col, 'to': f['ref'], 'refcol': refcol,
                            'composite': len(f['cols']) > 1, 'on_delete': f['on_delete'], 'logical': False})
    for frm, col, to, refcol in LOGICAL:
        if frm in tables and to in tables:
            out.append({'from': frm, 'col': col, 'to': to, 'refcol': refcol, 'composite': False, 'on_delete': '', 'logical': True})
    return out


def col_note(t, c, links):
    parts = []
    if c['n'] in t['pk']: parts.append('PK')
    elif c['nn']: parts.append('NOT NULL')
    if [c['n']] in t['uniques'] and c['n'] not in t['pk']: parts.append('UNIQUE')
    for l in links:
        ref = f"{l['to']}({l['refcol']})"
        parts.append(('documented link → ' if l['logical'] else 'FK → ') + ref
                     + (' (composite with tenant_id)' if l['composite'] else '')
                     + (f" ON DELETE {l['on_delete']}" if l['on_delete'] else ''))
    return ', '.join(parts)


def atlas_data(tables, links, desc, notes):
    by_col = {}
    for l in links: by_col.setdefault((l['from'], l['col']), []).append(l)
    referenced = {(l['to'], l['refcol']) for l in links}
    order = {s: i for i, s in enumerate(SCHEMA_ORDER)}
    out = []
    for key in sorted(tables, key=lambda k: (order.get(tables[k]['schema'], 99), k)):
        t = tables[key]
        cols = []
        for c in t['cols']:
            ls = by_col.get((key, c['n']), [])
            k = 'PK' if c['n'] in t['pk'] else ('UQ' if [c['n']] in t['uniques'] or (key, c['n']) in referenced else '')
            fk = ls[0] if ls else None
            cols.append({'n': c['n'], 't': c['t'], 'k': k,
                         'fk': f"{fk['to']}.{fk['refcol']}" if fk else '', 'logical': bool(fk and fk['logical']),
                         'note': notes.get(key, {}).get(c['n']) or col_note(t, c, ls)})
        out.append({'schema': t['schema'], 'name': t['name'], 'desc': desc.get(key, ''), 'cols': cols})
    return out


# ------------------------------------------------------------------- mermaid
def mm_type(t):
    t = t.replace('[]', '_array')
    return re.sub(r'\(.*?\)', '', t).replace(' ', '_') or 'TEXT'


def mermaid_block(tables, links, version):
    order = [s for s in SCHEMA_ORDER if any(t['schema'] == s for t in tables.values())]
    count = Counter(t['schema'] for t in tables.values())
    L = [BEGIN, '',
         f'_Generated from the `CREATE TABLE` statements in `db_scripts/` (schema {version}) by '
         '`python docs/tools/gen_db_diagram.py` — do not edit by hand, re-run the script after changing '
         '`02_tables_core.sql` / `03_tables_product.sql`._', '',
         '**Interactive version:** open [`docs/db-schema-atlas.html`](db-schema-atlas.html) in a browser — every column '
         'of every table, all foreign keys drawn between them, search, and a per-table panel listing what it '
         'references and what references it.', '',
         '### How the schemas connect', '',
         'Arrows point from the schema holding the foreign key to the schema it references; the label is the '
         'number of FK columns. `entity` (tenants, organizations) and `iam` (users, roles) are the foundation '
         'every product builds on.', '', '```mermaid', 'flowchart BT']
    for s in order:
        L.append(f'  {s}["<b>{s}</b><br/>{count[s]} table{"s" if count[s] != 1 else ""}"]')
    agg = Counter((l['from'].split('.')[0], l['to'].split('.')[0]) for l in links if not l['logical'])
    for (a, b), n in sorted(agg.items(), key=lambda x: (order.index(x[0][0]), order.index(x[0][1]))):
        if a != b: L.append(f'  {a} -- {n} --> {b}')
    L += ['```', '', '### Per-schema diagrams', '',
          'One diagram per schema, **key columns only** (PK, FK, unique, referenced). The full column lists are '
          'in *Table Details* below. Tables from other schemas appear as plain boxes. Conventions:', '',
          '- `}o--||` many rows reference exactly one row (NOT NULL FK); `}o--o|` the FK is nullable; '
          '`|o--||` a 1:1 extension (the FK is also the PK or unique).',
          '- **`org_id` / `tenant_id` links to `entity.organizations` / `entity.tenants` are left out** outside the '
          '`entity` schema — nearly every table has them. They still show as FK columns.',
          '- Composite `(tenant_id, x)` FKs are drawn on `x`.', '']
    for s in order:
        keys = [k for k in tables if tables[k]['schema'] == s]
        L += [f'#### `{s}`', '', '```mermaid', 'erDiagram']
        for key in keys:
            t = tables[key]
            fkcols = {l['col'] for l in links if l['from'] == key}
            refd = {l['refcol'] for l in links if l['to'] == key}
            attrs = []
            for c in t['cols']:
                tags = []
                if c['n'] in t['pk']: tags.append('PK')
                if c['n'] in fkcols: tags.append('FK')
                if [c['n']] in t['uniques'] or (c['n'] in refd and c['n'] not in t['pk']): tags.append('UK')
                if tags: attrs.append(f'    {mm_type(c["t"])} {c["n"]} {",".join(dict.fromkeys(tags))}')
            L += [f'  {t["name"]} {{'] + attrs + ['  }']
        for l in links:
            if l['from'].split('.')[0] != s: continue
            if l['to'] in TENANCY and s != 'entity': continue
            t = tables[l['from']]
            col = next(c for c in t['cols'] if c['n'] == l['col'])
            one_to_one = ([l['col']] == t['pk']) or ([l['col']] in t['uniques'])
            left = '|o' if one_to_one else '}o'
            right = '||' if col['nn'] else 'o|'
            dash = '..' if l['logical'] else '--'
            L.append(f'  {l["from"].split(".")[1]} {left}{dash}{right} {l["to"].split(".")[1]} : "{l["col"]}"')
        L += ['```', '']
    L.append(END)
    return '\n'.join(L)


def main():
    tables = parse_ddl()
    names = Counter(t['name'] for t in tables.values())
    dupes = [n for n, c in names.items() if c > 1]
    if dupes: sys.exit(f'table names must be unique across schemas for the Mermaid diagrams: {dupes}')
    version = schema_version()
    links = links_of(tables)
    desc, notes = parse_doc(tables)

    doc = open(DOC, encoding='utf-8').read()
    if BEGIN not in doc or END not in doc: sys.exit(f'{DOC} is missing the {BEGIN} / {END} markers')
    doc = doc[:doc.index(BEGIN)] + mermaid_block(tables, links, version) + doc[doc.index(END) + len(END):]
    open(DOC, 'w', encoding='utf-8', newline='\n').write(doc)

    data = json.dumps(atlas_data(tables, links, desc, notes), ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html = open(TEMPLATE, encoding='utf-8').read().replace('__DATA__', data).replace('__VERSION__', version)
    open(ATLAS, 'w', encoding='utf-8', newline='\n').write(html)

    print(f'schema {version}: {len(tables)} tables, {sum(len(t["cols"]) for t in tables.values())} columns, '
          f'{sum(not l["logical"] for l in links)} FK links + {sum(l["logical"] for l in links)} documented links')
    print(f'wrote {os.path.relpath(ATLAS, REPO)} and the diagram block in {os.path.relpath(DOC, REPO)}')


if __name__ == '__main__':
    main()
