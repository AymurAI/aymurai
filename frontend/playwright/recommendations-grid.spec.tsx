import { expect, test } from "@playwright/experimental-ct-react";
import { RecommendationsGridFixture } from "@/test/playwright-fixtures/recommendations-grid-fixture";

const PUBLISHABLE_CONTENT =
  "La Defensoría recomienda garantizar la atención integral, publicar los resultados del seguimiento y comunicar las medidas adoptadas a todas las personas afectadas.";

test("seguimiento preserves its frame, control heights and inner scrolling", async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(<RecommendationsGridFixture />);
  await expect(
    component.getByText("Recomendaciones · Seguimiento"),
  ).toBeVisible();
  const tableBeforeFilters = await component.locator("table").boundingBox();
  await component.getByRole("button", { name: "Mostrar filtros" }).click();
  const filters = component.getByRole("complementary", { name: "Filtros" });
  await expect(filters).toBeVisible();
  const panelBounds = await filters.boundingBox();
  const tableWithFilters = await component.locator("table").boundingBox();
  expect(tableWithFilters).toEqual(tableBeforeFilters);
  expect(panelBounds?.x).toBeGreaterThan(tableWithFilters?.x ?? 0);

  const filterHeader = filters.locator("header");
  const filterBody = filters.getByTestId("recommendations-filter-body");
  await expect(
    filterHeader.getByText("Filtros", { exact: true }),
  ).toBeVisible();
  await expect(
    filterHeader.getByRole("button", { name: "Limpiar filtros" }),
  ).toBeVisible();
  const headerBeforeScroll = await filterHeader.boundingBox();
  await filterBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await filterHeader.boundingBox()).toEqual(headerBeforeScroll);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("filters-drawer.png") });
  await component.getByRole("button", { name: "Ocultar filtros" }).click();

  const table = component.locator("table");
  const scroll = table.locator("..");
  const frame = scroll.locator("..");
  const input = table.getByRole("textbox").first();
  const select = table.getByRole("combobox").first();
  await expect(input).toBeVisible();
  expect((await input.locator("..").boundingBox())?.height).toBe(40);
  expect((await select.boundingBox())?.height).toBe(40);
  const bounds = await frame.boundingBox();
  expect(bounds?.height).toBeGreaterThan(100);
  for (const fraction of [0, 0.5, 1]) {
    await scroll.evaluate((el, f) => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) * f;
    }, fraction);
    await expect(frame).toHaveCSS("overflow", "hidden");
    const edges = await frame.evaluate((el) => {
      const style = getComputedStyle(el);
      return [
        style.borderLeftWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
      ];
    });
    expect(edges).toEqual(["1px", "1px", "1px"]);
    expect(await frame.boundingBox()).toEqual(bounds);
    const firstHeader = await table.locator("thead th").first().boundingBox();
    const scrollBounds = await scroll.boundingBox();
    expect(
      Math.abs((firstHeader?.x ?? 0) - (scrollBounds?.x ?? 0)),
    ).toBeLessThan(2);
    await page.screenshot({
      path: testInfo.outputPath(`scroll-${fraction}.png`),
    });
  }
  const content = table
    .getByRole("button", {
      name: `Contenido para publicar: ${PUBLISHABLE_CONTENT}`,
    })
    .first();
  await expect(content).toBeVisible();
  await expect(content).toHaveCSS("-webkit-line-clamp", "3");
  await content.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText(PUBLISHABLE_CONTENT);
  await expect(tooltip).toHaveCSS("color", "rgb(255, 255, 255)");

  const editLink = table.locator('a[aria-label="Editar"]').first();
  await expect(editLink).toBeAttached();
  await expect(editLink).not.toHaveAttribute("title");
  await scroll.evaluate((el) => {
    el.scrollTop = 200;
  });
  const header = await table.locator("thead th").last().boundingBox();
  const viewport = await scroll.boundingBox();
  expect(Math.abs((header?.y ?? 0) - (viewport?.y ?? 0))).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const recommendationHeaderAppearance = await table
    .locator("thead th")
    .nth(2)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderBottom: style.borderBottom,
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        paddingBlock: style.paddingBlock,
      };
    });

  await component
    .getByRole("tab", { name: "Destinatarios", exact: true })
    .click();
  await expect(component.getByText("Ana Pérez").first()).toBeVisible();
  await expect(component.getByText("Secundario").first()).toBeVisible();

  const recipientTable = component.locator("table");
  const recipientHeaderAppearance = await recipientTable
    .locator("thead th")
    .nth(2)
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderBottom: style.borderBottom,
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        paddingBlock: style.paddingBlock,
      };
    });
  expect(recipientHeaderAppearance).toEqual(recommendationHeaderAppearance);

  const recipientScroll = recipientTable.locator("..");
  await recipientScroll.evaluate((element) => {
    element.scrollTop = 200;
    element.scrollLeft = element.scrollWidth - element.clientWidth;
  });
  const recipientViewport = await recipientScroll.boundingBox();
  const recipientFirstHeader = await recipientTable
    .locator("thead th")
    .first()
    .boundingBox();
  expect(
    Math.abs((recipientFirstHeader?.x ?? 0) - (recipientViewport?.x ?? 0)),
  ).toBeLessThan(2);
  expect(
    Math.abs((recipientFirstHeader?.y ?? 0) - (recipientViewport?.y ?? 0)),
  ).toBeLessThan(2);

  const recipientEditLink = component.locator('a[aria-label="Editar"]').first();
  await expect(recipientEditLink).toBeAttached();
  await expect(recipientEditLink).not.toHaveAttribute("title");
});
