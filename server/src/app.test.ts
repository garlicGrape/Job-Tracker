import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { createDb } from "./db.js";

describe("Job Tracker API", () => {
  let server: Server;
  let baseUrl: string;
  const db = createDb(":memory:");

  before(async () => {
    const app = createApp(db);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    server?.close();
    db.close();
  });

  test("GET /api/health returns ok", async () => {
    const res = await request(baseUrl).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });

  test("starts with an empty job list", async () => {
    const res = await request(baseUrl).get("/api/jobs");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test("creates a job", async () => {
    const res = await request(baseUrl)
      .post("/api/jobs")
      .send({ company: "Acme", position: "Engineer", status: "Applied" });
    assert.equal(res.status, 201);
    assert.equal(res.body.company, "Acme");
    assert.equal(res.body.position, "Engineer");
    assert.equal(res.body.status, "Applied");
    assert.ok(res.body.id > 0);
  });

  test("rejects a job without a company", async () => {
    const res = await request(baseUrl)
      .post("/api/jobs")
      .send({ position: "Engineer" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /company/);
  });

  test("rejects an invalid status", async () => {
    const res = await request(baseUrl)
      .post("/api/jobs")
      .send({ company: "Acme", position: "Engineer", status: "Nope" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /status/);
  });

  test("updates a job's status", async () => {
    const created = await request(baseUrl)
      .post("/api/jobs")
      .send({ company: "Globex", position: "Dev", status: "Applied" });
    const id = created.body.id;

    const updated = await request(baseUrl)
      .put(`/api/jobs/${id}`)
      .send({ company: "Globex", position: "Dev", status: "Offer" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, "Offer");
  });

  test("filters jobs by status", async () => {
    const res = await request(baseUrl).get("/api/jobs?status=Offer");
    assert.equal(res.status, 200);
    assert.ok(res.body.every((j: { status: string }) => j.status === "Offer"));
    assert.ok(res.body.length >= 1);
  });

  test("reports aggregate stats", async () => {
    const res = await request(baseUrl).get("/api/stats");
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 2);
    assert.equal(res.body.byStatus.Offer, 1);
    assert.equal(typeof res.body.byStatus.Applied, "number");
  });

  test("deletes a job", async () => {
    const created = await request(baseUrl)
      .post("/api/jobs")
      .send({ company: "Initech", position: "PM", status: "Wishlist" });
    const id = created.body.id;

    const del = await request(baseUrl).delete(`/api/jobs/${id}`);
    assert.equal(del.status, 204);

    const after = await request(baseUrl).get(`/api/jobs/${id}`);
    assert.equal(after.status, 404);
  });
});
