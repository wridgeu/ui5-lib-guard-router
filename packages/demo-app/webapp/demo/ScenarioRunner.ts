import JSONModel from "sap/ui/model/json/JSONModel";
import type ResourceModel from "sap/ui/model/resource/ResourceModel";
import { setRuntimeMessage } from "../model/runtime";
import { runHashSequence, setHash } from "../routing/hashNavigation";

const RAPID_HASH_SEQUENCE = ["#/protected", "#/forbidden", "#/protected"];

export default class ScenarioRunner {
	private readonly _runtimeModel: JSONModel;

	private readonly _i18nModel: ResourceModel;

	constructor(runtimeModel: JSONModel, i18nModel: ResourceModel) {
		this._runtimeModel = runtimeModel;
		this._i18nModel = i18nModel;
	}

	/**
	 * Show a text of the i18n bundle as the last action.
	 *
	 * @param key - Key of the text in i18n.properties
	 * @param args - Values for the placeholders of the text
	 */
	recordAction(key: string, args?: string[]): void {
		// The i18n model loads its bundle asynchronously ("async": true in the manifest).
		void Promise.resolve(this._i18nModel.getResourceBundle()).then((bundle) => {
			setRuntimeMessage(this._runtimeModel, bundle.getText(key, args) ?? key);
		});
	}

	goToProtectedByHash(): void {
		this._setHash("#/protected", "actionHashTo", ["protected"]);
	}

	goToBlockedByHash(): void {
		this._setHash("#/blocked", "actionHashTo", ["blocked"]);
	}

	goToForbiddenByHash(): void {
		this._setHash("#/forbidden", "actionHashTo", ["forbidden"]);
	}

	goToMissingRouteByHash(): void {
		this._setHash("#/this/does/not/exist", "actionHashMissing");
	}

	runRapidHashSequence(): void {
		this.recordAction("actionRapidHash", [RAPID_HASH_SEQUENCE.map((hash) => hash.replace("#/", "")).join(" -> ")]);
		runHashSequence(RAPID_HASH_SEQUENCE);
	}

	private _setHash(hash: string, key: string, args?: string[]): void {
		this.recordAction(key, args);
		setHash(hash);
	}
}
