export interface WriterBootstrapSubmissionGate {
  begin: () => boolean;
  fail: () => void;
  succeed: () => void;
}

export function createWriterBootstrapSubmissionGate(): WriterBootstrapSubmissionGate {
  let locked = false;
  return {
    begin: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    fail: () => {
      locked = false;
    },
    succeed: () => {
      locked = true;
    },
  };
}
