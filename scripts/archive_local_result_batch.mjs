/** Stream a native result batch into the folder bound by the web app.
 * node scripts/archive_local_result_batch.mjs <folder> <batch.jsonl>
 * Line 1: {owner,scope,revision,revisions,savedAt,source?}
 * Next: {group:{id,title,at,parent?},settings:{...}} followed by its
 * {symbol,time,summary,record:{id,...}} rows. Each group is a complete snapshot.
 * After this succeeds, run publish_local_result_directory.mjs for the same scope.
 */
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {writeResultArchive} from './result_library_writer.mjs';

const [root,input] = process.argv.slice(2);
if (!root || !input) throw Error('Expected archive folder and JSONL batch file');
const lines = createInterface({input:createReadStream(input,{encoding:'utf8'}),crlfDelay:Infinity});
const records = lines[Symbol.asyncIterator]();
const first = await records.next();
if (first.done) throw Error('Empty batch');
const {owner,scope,revision,revisions,savedAt,source} = JSON.parse(first.value);
const header = await writeResultArchive({root,owner,scope,revision,revisions,savedAt,source,merge:true},async group=>{
  let append;
  let groupCount = 0;
  for await (const line of records) {
    const entry = JSON.parse(line);
    if (entry.group) {
      if (!Object.hasOwn(entry,'settings')) throw Error('Missing group settings');
      append = group(entry.group,entry.settings);
      groupCount++;
    } else {
      if (!append) throw Error('Expected a directory before its records');
      append(entry);
    }
  }
  if (!groupCount) throw Error('Empty batch');
});
console.log(scope,header.groups.length,'local directories verified');
