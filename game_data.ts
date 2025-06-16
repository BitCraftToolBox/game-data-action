import {DbConnection, REMOTE_MODULE} from './ts'
import {AlgebraicType, BinaryWriter, Identity} from "@clockworklabs/spacetimedb-sdk";
import * as fs from "node:fs";

const data_dir = process.env.DATA_DIR || "bins";

let tables = fs.readFileSync('region_tables.txt', ).toString().split('\n');
let newTables = [];
for (let table of tables) {
  table = table.trim();
  if (table) {
    newTables.push(table);
  }
}
tables = newTables;
!fs.existsSync(data_dir) && fs.mkdirSync(data_dir);

const snakeToCamel = (str: string) =>
  str.toLowerCase().replace(/([-_][a-z])/g, group =>
    group
      .toUpperCase()
      .replace('_', '')
  );

type KeyType = keyof typeof REMOTE_MODULE.tables;
type KeyPair = {
  camel: string;
  snake: KeyType;
}

const subscriptions: string[] = [];
const mappings = new Map<KeyPair, AlgebraicType>();

for (let tableName of tables) {
  const tableKey = tableName as KeyType;
  const table = REMOTE_MODULE.tables[tableKey];
  tableName = table.tableName; // should always be the same
  const st_type = table.rowType;
  const st_arr_type = AlgebraicType.createArrayType(st_type);
  mappings.set({camel: snakeToCamel(tableKey), snake: tableKey}, st_arr_type);
  subscriptions.push(`SELECT * FROM ${tableKey};`)
}

const onConnect = (conn: DbConnection, identity: Identity) => {
  console.log(`Got identity: ${identity.toHexString()}`)

  conn.subscriptionBuilder().onApplied(() => {
    for (let [{camel, snake}, st_type ] of mappings.entries()) {
      const table: any = conn.db[camel as keyof typeof conn.db];
      const bw = new BinaryWriter(1024 * 1024);
      st_type.serialize(bw, Array.from(table.iter()));
      fs.writeFileSync(`${data_dir}/${snake}.bsatn`, bw.getBuffer());
    }

    conn.disconnect();

    const gho = process.env.GITHUB_OUTPUT;
    if (gho) {
      fs.appendFileSync(gho, "updated_data=true\n")
    }
  }).onError((ctx: any) => {
    console.log(ctx.event ?? "Unknown error");
  }).subscribe(subscriptions);
};


DbConnection.builder()
  .withUri('wss://' + process.env.BITCRAFT_SPACETIME_HOST)
  .withModuleName('bitcraft-9')
  .withToken(process.env.BITCRAFT_SPACETIME_AUTH || undefined)
  .onConnect(onConnect)
  .build()
