import { waitForPage, expectHashToBe, resetAuth, fireEvent } from "./helpers";

const VIEW_PREFIX = "container-demo.app---";

describe("Route metadata and inheritance", () => {
	before(async () => {
		await browser.goTo({ sHash: "" });
		await resetAuth();
		await waitForPage(`${VIEW_PREFIX}homeView--homePage`, "Home");
	});

	it("should display route metadata on employees page", async () => {
		const btn = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}homeView--navToEmployees` },
		});
		await btn.press();
		await waitForPage(`${VIEW_PREFIX}employeesView--employeesPage`, "Employees");
		await expectHashToBe("#/employees");

		const metaText = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeesView--employeesMeta` },
		});
		const text = await metaText.getText();
		const meta = JSON.parse(text);
		expect(meta.section).toBe("hr");
		expect(meta.requiresAuth).toBe(true);
	});

	it("should show inherited metadata on employee detail page", async () => {
		const btn = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeesView--navToEmployee` },
		});
		await btn.press();
		await waitForPage(`${VIEW_PREFIX}employeeView--employeePage`, "Employee Detail");
		await expectHashToBe("#/employees/42");

		const metaText = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeeView--employeeMeta` },
		});
		const text = await metaText.getText();
		const meta = JSON.parse(text);
		expect(meta.section).toBe("hr");
		expect(meta.requiresAuth).toBe(true);
		expect(meta.detail).toBe(true);
	});

	it("should navigate back to employees", async () => {
		await fireEvent(`${VIEW_PREFIX}employeeView--employeePage`, "navButtonPress");
		await waitForPage(`${VIEW_PREFIX}employeesView--employeesPage`, "Employees");
		await expectHashToBe("#/employees");
	});

	it("should reflect runtime metadata updates in inheritance", async () => {
		// Update metadata on employees
		const updateBtn = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeesView--updateMeta` },
		});
		await updateBtn.press();

		// Navigate to employee detail
		const navBtn = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeesView--navToEmployee` },
		});
		await navBtn.press();
		await waitForPage(`${VIEW_PREFIX}employeeView--employeePage`, "Employee Detail");

		const metaText = await browser.asControl({
			selector: { id: `${VIEW_PREFIX}employeeView--employeeMeta` },
		});
		const text = await metaText.getText();
		const meta = JSON.parse(text);
		expect(meta.updatedAt).toBeDefined();
		expect(meta.section).toBe("hr");
		expect(meta.detail).toBe(true);
	});
});
