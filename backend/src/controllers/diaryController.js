export function createDiaryController({ diaryService }) {
  return Object.freeze({
    async list(req, res) {
      const data = await diaryService.listEntries(req.auth.user.id, req.validatedQuery);
      return res.status(200).json(data);
    },

    async getOne(req, res) {
      const entry = await diaryService.getEntry(req.auth.user.id, req.params.id, {
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      return res.status(200).json({ entry });
    },

    async create(req, res) {
      const entry = await diaryService.createEntry(req.auth.user.id, req.validatedBody);
      return res.status(201).json({ entry });
    },

    async update(req, res) {
      const entry = await diaryService.updateEntry(req.auth.user.id, req.params.id, req.validatedBody, {
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      return res.status(200).json({ entry });
    },

    async remove(req, res) {
      await diaryService.deleteEntry(req.auth.user.id, req.params.id, {
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      return res.status(200).json({ deleted: true });
    },
  });
}
