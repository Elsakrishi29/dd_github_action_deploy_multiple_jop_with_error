const request = require("supertest");
const app = require("../index"); // Import app, NOT starting the server

describe("GET /", () => {
  it("should return Hello, CI/CD with Datadog!", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe("Hello, CI/CD with Datadog!");
  });
});