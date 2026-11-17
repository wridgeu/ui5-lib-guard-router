import { CONTROLS, selectorFor } from "../shared/controls";
import { waitForPage, expectHashToBe, resetAuth, fireEvent } from "./helpers";

describe("Route metadata and inheritance", () => {
	before(async () => {
		await browser.url("#");
		await resetAuth();
		await waitForPage(CONTROLS.home.homePage, "Home");
	});

	it("should display route metadata on employees page", async () => {
		const btn = await browser.asControl(selectorFor(CONTROLS.home.navToEmployees));
		await btn.press();
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await expectHashToBe("#/employees");

		const metaText = await browser.asControl(selectorFor(CONTROLS.employees.employeesMeta));
		const text = await metaText.getProperty("text");
		const meta = JSON.parse(text);
		expect(meta.section).toBe("hr");
		expect(meta.requiresAuth).toBe(true);
	});

	it("should show inherited metadata on employee detail page", async () => {
		const btn = await browser.asControl(selectorFor(CONTROLS.employees.navToEmployee));
		await btn.press();
		await waitForPage(CONTROLS.employee.employeePage, "Employee Detail");
		await expectHashToBe("#/employees/42");

		const metaText = await browser.asControl(selectorFor(CONTROLS.employee.employeeMeta));
		const text = await metaText.getProperty("text");
		const meta = JSON.parse(text);
		expect(meta.section).toBe("hr");
		expect(meta.requiresAuth).toBe(true);
		expect(meta.detail).toBe(true);
	});

	it("should navigate back to employees", async () => {
		await fireEvent(CONTROLS.employee.employeePage, "navButtonPress");
		await waitForPage(CONTROLS.employees.employeesPage, "Employees");
		await expectHashToBe("#/employees");
	});

	it("should reflect runtime metadata updates in inheritance", async () => {
		// Update metadata on employees
		const updateBtn = await browser.asControl(selectorFor(CONTROLS.employees.updateMeta));
		await updateBtn.press();

		// Navigate to employee detail
		const navBtn = await browser.asControl(selectorFor(CONTROLS.employees.navToEmployee));
		await navBtn.press();
		await waitForPage(CONTROLS.employee.employeePage, "Employee Detail");

		const metaText = await browser.asControl(selectorFor(CONTROLS.employee.employeeMeta));
		const text = await metaText.getProperty("text");
		const meta = JSON.parse(text);
		expect(meta.updatedAt).toBeDefined();
		expect(meta.section).toBe("hr");
		expect(meta.detail).toBe(true);
	});
});
