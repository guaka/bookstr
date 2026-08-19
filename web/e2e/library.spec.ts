import { expect, test } from "@playwright/test";

test.describe("bookstr web", () => {
  test("loads an empty personal library without bundled examples", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole("heading", { name: "Reading" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Favorites" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Examples" })).toHaveCount(
      0,
    );
    await expect(page.getByText("Little Brother")).toHaveCount(0);
  });

  test("detects a late NIP-07 injection and shows a NIP-46 QR", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.setTimeout(() => {
        window.nostr = {
          getPublicKey: async () => "a".repeat(64),
          signEvent: async (event) => ({
            ...event,
            id: "b".repeat(64),
            pubkey: "a".repeat(64),
            sig: "c".repeat(128),
          }),
        };
        window.dispatchEvent(new Event("nostr:ready"));
      }, 250);
    });
    await page.goto("/#/settings");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Connected via browser extension")).toBeVisible(
      { timeout: 10_000 },
    );

    await page.getByRole("button", { name: "Show Amber QR" }).click();
    await expect(
      page.getByAltText("nostrconnect QR code for Amber"),
    ).toBeVisible();
  });

  test("opens a LibVault PDF", async ({ page }) => {
    const md5 = "a".repeat(32);
    await page.route(`**/api/files/${md5}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.7\n",
      });
    });
    await page.goto(
      `/?libvaultMd5=${md5}&format=pdf&title=Test%20PDF#/read/${md5}`,
    );
    await expect(page.locator(".pdf-reader")).toBeVisible();
    await expect(page.locator("object.pdf-document")).toBeVisible();
    await expect(page.getByText("Test PDF")).toBeVisible();
  });
});
