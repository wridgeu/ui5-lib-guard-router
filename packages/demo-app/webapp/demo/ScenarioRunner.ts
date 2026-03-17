import JSONModel from "sap/ui/model/json/JSONModel";
import { setRuntimeMessage } from "../model/runtime";
import { runHashSequence, setHash } from "../routing/hashNavigation";

const RAPID_HASH_SEQUENCE = ["#/protected", "#/forbidden", "#/protected"];

export default class ScenarioRunner {
	private readonly _runtimeModel: JSONModel;

	constructor(runtimeModel: JSONModel) {
		this._runtimeModel = runtimeModel;
	}

	recordAction(message: string): void {
		setRuntimeMessage(this._runtimeModel, message);
	}

	goToProtectedByHash(): void {
		this._setHash("#/protected", 'Triggered direct hash navigation to "protected"');
	}

	goToForbiddenByHash(): void {
		this._setHash("#/forbidden", 'Triggered direct hash navigation to "forbidden"');
	}

	goToMissingRouteByHash(): void {
		this._setHash("#/this/does/not/exist", "Triggered direct hash navigation to a nonexistent route");
	}

	runRapidHashSequence(): void {
		this.recordAction("Triggered rapid hash sequence: protected -> forbidden -> protected");
		runHashSequence(RAPID_HASH_SEQUENCE);
	}

	private _setHash(hash: string, message: string): void {
		this.recordAction(message);
		setHash(hash);
	}
}
