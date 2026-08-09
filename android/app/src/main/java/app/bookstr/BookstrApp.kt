package app.bookstr

import android.app.Application
import app.bookstr.data.AppDatabase
import app.bookstr.data.CatalogRepository
import app.bookstr.data.NostrRepository
import app.bookstr.data.SettingsRepository

class BookstrApp : Application() {
    lateinit var settingsRepository: SettingsRepository
        private set
    lateinit var catalogRepository: CatalogRepository
        private set
    lateinit var nostrRepository: NostrRepository
        private set
    lateinit var database: AppDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        database = AppDatabase.create(this)
        settingsRepository = SettingsRepository(this)
        catalogRepository = CatalogRepository(this, settingsRepository, database.bookProgressDao())
        nostrRepository = NostrRepository(this, settingsRepository, database.bookProgressDao())
    }
}
