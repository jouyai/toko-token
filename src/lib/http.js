export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Validasi body dengan skema zod; lempar 400 dengan pesan pertama yang gagal.
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || "Data tidak valid");
  return r.data;
}
