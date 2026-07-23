function parseRelineCommand(text) {
  const value = typeof text === "string" ? text : "";
  const isReline = value.includes("รีไลน์");

  if (!isReline) {
    return {
      isReline: false,
      countdownTarget: null,
    };
  }

  const countdownMatch = value.match(/รีไลน์\s+(\d{1,2})(?=\s|$)/);
  const countdownTarget = countdownMatch ? Number(countdownMatch[1]) : null;

  return {
    isReline: true,
    countdownTarget:
      countdownTarget !== null && countdownTarget >= 1 && countdownTarget <= 99
        ? countdownTarget
        : null,
  };
}

module.exports = parseRelineCommand;
