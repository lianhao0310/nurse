import { test, expect } from "@playwright/test";
import path from "path";

const FRONTEND_URL = "file://" + path.resolve(__dirname, "../../frontend/index.html").replace(/\\/g, "/");

test.describe("冒烟测试：前端初始化", () => {
  test("所有脚本加载成功，init() 不报错，页面渲染非空白", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(FRONTEND_URL, { waitUntil: "load" });

    await page.waitForFunction(() => {
      const el = document.querySelector("#header-title");
      return el && el.textContent === "Nurse";
    }, { timeout: 15000 }).catch(() => {});

    const headerTitle = await page.locator("#header-title").textContent();
    expect(headerTitle).toBe("Nurse");

    const tabCount = await page.locator(".tabbar__btn, [data-page]").count();
    expect(tabCount).toBeGreaterThan(0);

    const script404Errors = consoleErrors.filter((e) => e.includes("404") || e.includes("Failed to load"));
    expect(script404Errors).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test("consult-ai.js 正确加载并挂载 window.NurseConsult", async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: "load" });
    const hasConsult = await page.evaluate(() => typeof window.NurseConsult !== "undefined");
    expect(hasConsult).toBe(true);
  });

  test("consult-chat.js 正确加载并挂载 window.NurseConsultChat", async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: "load" });
    const hasChat = await page.evaluate(() => typeof window.NurseConsultChat !== "undefined");
    expect(hasChat).toBe(true);
  });
});
