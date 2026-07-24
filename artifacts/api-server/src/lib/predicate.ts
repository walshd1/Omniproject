/**
 * Predicate engine — re-exported from the shared catalogue.
 *
 * The pure "when" language now lives in `@workspace/backend-catalogue` (`src/predicate.ts`) so it is a
 * single condition engine across BOTH apps and every rule plane (governance, costing, automation/rules).
 * This module stays as the api-server import path (`./predicate`) so existing callers are untouched.
 */
export {
  evaluatePredicate,
  matches,
  selectMatching,
  validatePredicate,
  cleanConditionSet,
  type Op,
  type Predicate,
  type ConditionSet,
  type Context,
} from "@workspace/backend-catalogue";
