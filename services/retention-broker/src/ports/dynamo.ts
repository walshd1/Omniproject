/**
 * DynamoDB-backed `TableStorePort` (also fits any single-table PK/SK store). The DocumentClient is
 * INJECTED for testability; `dynamoDocFromEnv` builds the real one. Below-the-seam SDK code.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { SkQuery, TableItem, TableStorePort } from "../contract";

export interface DynamoPortConfig {
  doc: DynamoDBDocumentClient;
  table: string;
}

export function dynamoTableStorePort(cfg: DynamoPortConfig): TableStorePort {
  const { doc, table } = cfg;
  return {
    async putItem(item: TableItem) {
      await doc.send(new PutCommand({ TableName: table, Item: { pk: item.pk, sk: item.sk, data: item.data } }));
    },
    async query(q: SkQuery): Promise<TableItem[]> {
      const names: Record<string, string> = { "#pk": "pk", "#sk": "sk" };
      const values: Record<string, unknown> = { ":pk": q.pk };
      let cond = "#pk = :pk";
      if (q.fromSk !== undefined && q.toSk !== undefined) {
        cond += " AND #sk BETWEEN :from AND :to"; // inclusive; the connector post-filters the open end
        values[":from"] = q.fromSk;
        values[":to"] = q.toSk;
      } else {
        cond += " AND begins_with(#sk, :pre)";
        values[":pre"] = q.skPrefix;
      }
      const out: TableItem[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const res = await doc.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: cond,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ScanIndexForward: !q.descending,
            ...(q.limit !== undefined ? { Limit: q.limit } : {}),
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          }),
        );
        for (const it of res.Items ?? []) out.push({ pk: String(it["pk"]), sk: String(it["sk"]), data: it["data"] });
        startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (q.limit !== undefined && out.length >= q.limit) break;
      } while (startKey);
      return q.limit !== undefined ? out.slice(0, q.limit) : out;
    },
  };
}

export function dynamoDocFromEnv(env: NodeJS.ProcessEnv = process.env): DynamoDBDocumentClient {
  const region = env["AWS_REGION"];
  const endpoint = env["DYNAMODB_ENDPOINT"]; // set for DynamoDB Local
  const base = new DynamoDBClient({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
  });
  return DynamoDBDocumentClient.from(base);
}
