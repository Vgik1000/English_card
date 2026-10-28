export class ImportFileError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ImportFileError';
  }
}

export function getImportErrorMessage(error) {
  if (error instanceof ImportFileError) return error.message;
  return 'Не удалось подготовить импорт. Попробуйте выбрать файл ещё раз. Если ошибка повторяется, перезагрузите приложение.';
}
