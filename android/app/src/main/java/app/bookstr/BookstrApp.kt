package app.bookstr

import android.app.Application
import app.bookstr.data.AppDatabase
import app.bookstr.data.CatalogRepository
import app.bookstr.data.NostrRepository
import app.bookstr.data.NostrFavoritesRepository
import app.bookstr.data.SettingsRepository
import app.bookstr.data.VocabularyRepository
import app.bookstr.data.DictionaryRepository

class BookstrApp : Application() {
    lateinit var settingsRepository: SettingsRepository
        private set
    lateinit var catalogRepository: CatalogRepository
        private set
    lateinit var nostrRepository: NostrRepository
        private set
    lateinit var nostrFavoritesRepository: NostrFavoritesRepository
        private set
    lateinit var database: AppDatabase
        private set
    lateinit var vocabularyRepository: VocabularyRepository
        private set
    lateinit var dictionaryRepository: DictionaryRepository
        private set

    override fun onCreate() {
        super.onCreate()
        database = AppDatabase.create(this)
        vocabularyRepository = VocabularyRepository(database.vocabularyWordDao())
        dictionaryRepository = DictionaryRepository(this)
        settingsRepository = SettingsRepository(this)
        catalogRepository = CatalogRepository(this, database.bookProgressDao(), settingsRepository)
        nostrRepository = NostrRepository(
            this,
            settingsRepository,
            database.bookProgressDao(),
            vocabularyRepository,
        )
        nostrFavoritesRepository = NostrFavoritesRepository(this, settingsRepository)
    }
}
