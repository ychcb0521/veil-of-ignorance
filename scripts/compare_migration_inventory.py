#!/usr/bin/env python3
"""Compare two read-only inventory files; never accesses or changes a database."""
import argparse,json,sys
from pathlib import Path

def table_map(doc):
    rows=doc.get('tables',doc.get('rows',[]))
    result={}
    for row in rows:
        schema=row.get('schema_name',row.get('schemaname','public'))
        key=schema+'.'+row['table_name']
        if key in result:raise ValueError('Duplicate table in inventory: '+key)
        result[key]=int(row['row_count'])
    if not result:raise ValueError('No table counts in inventory')
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path);p.add_argument('target',type=Path)
    p.add_argument('--output',type=Path)
    args=p.parse_args()
    source=table_map(json.loads(args.source.read_text()))
    target=table_map(json.loads(args.target.read_text()))
    rows=[{'table':k,'source':source.get(k),'target':target.get(k),'matches':k in source and k in target and source[k]==target[k]} for k in sorted(source.keys()|target.keys())]
    report={'matches':all(r['matches'] for r in rows),'tables':rows,'limitation':'Row counts alone do not prove value, relationship, RLS or storage-file integrity.'}
    output=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
    if args.output:
        if args.output.exists():raise ValueError('Refusing to overwrite an existing comparison report')
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(output)
    print(output,end='')
    return 0 if report['matches'] else 1

if __name__=='__main__':
    try:sys.exit(main())
    except (OSError,ValueError,KeyError) as e:
        print('Inventory comparison failed: '+str(e),file=sys.stderr);sys.exit(2)
