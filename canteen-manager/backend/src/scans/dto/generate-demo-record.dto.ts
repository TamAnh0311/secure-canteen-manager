// Body for POST /scans/demo — fabricates a synthetic flagged OMR sheet against the global
// menu, dated to today, so the verify flow can be demoed without a scanner or omr-service.
// The menu and form template are global, so the request carries no fields.
export class GenerateDemoRecordDto {}
