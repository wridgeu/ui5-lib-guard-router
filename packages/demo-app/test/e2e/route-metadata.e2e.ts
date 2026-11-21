import { CONTROLS, type ControlRef, getAppComponentId, getControl, press } from "../shared/controls";
import { expectHashToBe, waitForPage } from "./helpers/wait";
import { fireEvent } from "./helpers/browser";
import { startAtHome } from "./helpers/scenarios";

const EMPLOYEES_META = { section: "hr", requiresAuth: true };
const EMPLOYEE_META = { ...EMPLOYEES_META, detail: true };

/** The views display `router.getRouteMeta(route)` as JSON. The placeholder text of a view that never displayed it fails the parse. */
async function readDisplayedMeta(ref: ControlRef): Promise<Record<string, unknown>> {
	const control = await getControl(ref);
	return JSON.parse((await control.getProperty("text")) as string) as Record<string, unknown>;
}

async function openEmployees(): Promise<void> {
	await press(CONTROLS.home.navToEmployees);
	await waitForPage(CONTROLS.employees.employeesPage, "Employees");
	await expectHashToBe("#/employees");
}

async function openEmployee(): Promise<void> {
	await press(CONTROLS.employees.navToEmployee);
	await waitForPage(CONTROLS.employee.employeePage, "Employee Detail");
	await expectHashToBe("#/employees/42");
}

async function navBackToEmployees(): Promise<void> {
	await fireEvent(CONTROLS.employee.employeePage, "navButtonPress");
	await waitForPage(CONTROLS.employees.employeesPage, "Employees");
	await expectHashToBe("#/employees");
}

describe("Route metadata and inheritance", () => {
	beforeEach(async () => {
		await startAtHome();
	});

	it("should display route metadata on employees page", async () => {
		await openEmployees();

		expect(await readDisplayedMeta(CONTROLS.employees.employeesMeta)).toEqual(EMPLOYEES_META);
	});

	it("should show inherited metadata on employee detail page", async () => {
		await openEmployees();
		await openEmployee();

		expect(await readDisplayedMeta(CONTROLS.employee.employeeMeta)).toEqual(EMPLOYEE_META);
	});

	it("should navigate back to employees", async () => {
		await openEmployees();
		await openEmployee();

		await navBackToEmployees();
	});

	it("should reflect runtime metadata updates in inheritance", async () => {
		// Resolve the inherited metadata once before the update, so that the update
		// has to replace an already computed result.
		await openEmployees();
		await openEmployee();
		expect(await readDisplayedMeta(CONTROLS.employee.employeeMeta)).toEqual(EMPLOYEE_META);
		await navBackToEmployees();

		try {
			await press(CONTROLS.employees.updateMeta);
			expect(await readDisplayedMeta(CONTROLS.employees.employeesMeta)).toEqual({
				...EMPLOYEES_META,
				updatedAt: expect.any(String),
			});

			await openEmployee();
			expect(await readDisplayedMeta(CONTROLS.employee.employeeMeta)).toEqual({
				...EMPLOYEE_META,
				updatedAt: expect.any(String),
			});
		} finally {
			// The page is not reloaded between tests: put the manifest metadata back.
			await browser.execute(
				(id: string, meta: Record<string, unknown>) => {
					const Component = sap.ui.require("sap/ui/core/Component");
					Component.getComponentById(id).getRouter().setRouteMeta("employees", meta);
				},
				await getAppComponentId(),
				EMPLOYEES_META,
			);
		}
	});
});
