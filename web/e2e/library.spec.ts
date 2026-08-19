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

  test("applies a stored night theme before the app loads", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("bookstr.setting.theme", "night"),
    );
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).backgroundColor,
        ),
      )
      .toBe("rgb(18, 18, 18)");
  });

  test("clears the opening state after a download fails", async ({ page }) => {
    const md5 = "d".repeat(32);
    await page.addInitScript((bookId) => {
      localStorage.setItem("bookstr.favorites", JSON.stringify([bookId]));
    }, md5);
    await page.route(`**/api/files/${md5}`, async (route) => {
      await route.fulfill({ status: 500, body: "failed" });
    });
    await page.goto(`/?libvaultMd5=${md5}&title=Broken%20Book#/`);

    const book = page.getByRole("button", { name: /Broken Book/ }).first();
    await book.click();
    await expect(page.getByText("Download HTTP 500")).toBeVisible();
    await expect(page.getByText("Downloading and opening…")).toHaveCount(0);
    await expect(book).toBeEnabled();
  });

  test("detects a late NIP-07 injection and hides fallback signers", async ({
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
    await expect(page.getByText("Remote signer (NIP-46)")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Show Amber QR" }),
    ).toHaveCount(0);
    await expect(page.getByText("Paste bunker:// instead")).toHaveCount(0);
    await expect(page.getByText("Use nsec instead (advanced)")).toHaveCount(0);

    await page.getByLabel("Theme").selectOption("night");
    await expect
      .poll(() =>
        page
          .getByLabel("Theme")
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(232, 228, 220)");
  });

  test("shows a canvas-free NIP-46 QR without a browser signer", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.toDataURL = () => {
        throw new Error("Canvas export blocked by Firefox privacy protection");
      };
    });
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "Show Amber QR" }).click();
    const qr = page.getByAltText("nostrconnect QR code for Amber");
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("src", /^data:image\/svg\+xml/);
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
