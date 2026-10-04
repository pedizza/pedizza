import "server-only";
import { transaction, one } from "@/lib/db";
import { invariant } from "@/lib/errors";
// Private PostgreSQL storage: no Supabase API/service key is needed.
export function privateFiles() {
  return {
    storage: {
      from(bucket: string) {
        invariant(
          ["store-logos", "menu-images", "conversation-media"].includes(bucket),
          "Destino inválido.",
        );
        return {
          async upload(
            path: string,
            data: Buffer,
            options: { contentType: string; upsert: boolean },
          ) {
            const tenant = path.split("/")[0];
            invariant(/^[0-9a-f-]{36}$/.test(tenant), "Caminho inválido.");
            await transaction((db) =>
              db.query(
                "insert into private.files(bucket,path,tenant_id,mime,body) values($1,$2,$3,$4,$5)",
                [bucket, path, tenant, options.contentType, data],
              ),
            );
            return { error: null };
          },
          async remove(paths: string[]) {
            await transaction((db) =>
              db.query(
                "delete from private.files where bucket=$1 and path=any($2::text[])",
                [bucket, paths],
              ),
            );
            return { error: null };
          },
          async download(path: string) {
            const file = await transaction((db) =>
              one<{ body: Buffer; mime: string }>(
                db,
                "select body,mime from private.files where bucket=$1 and path=$2",
                [bucket, path],
              ),
            );
            return {
              data: file
                ? new Blob([new Uint8Array(file.body)], { type: file.mime })
                : null,
              error: file ? null : "not_found",
            };
          },
        };
      },
    },
  };
}
