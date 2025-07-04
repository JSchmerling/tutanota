/* generated file, don't edit. */


@file:Suppress("NAME_SHADOWING")
package de.tutao.tutashared.ipc

import kotlinx.serialization.*
import kotlinx.serialization.json.*

class MobileSystemFacadeReceiveDispatcher(
	private val json: Json,
	private val facade: MobileSystemFacade,
) {
	
	suspend fun dispatch(method: String, arg: List<String>): String {
		when (method) {
			"goToSettings" -> {
				val result: Unit = this.facade.goToSettings(
				)
				return json.encodeToString(result)
			}
			"openLink" -> {
				val uri: String = json.decodeFromString(arg[0])
				val result: Boolean = this.facade.openLink(
					uri,
				)
				return json.encodeToString(result)
			}
			"shareText" -> {
				val text: String = json.decodeFromString(arg[0])
				val title: String = json.decodeFromString(arg[1])
				val result: Boolean = this.facade.shareText(
					text,
					title,
				)
				return json.encodeToString(result)
			}
			"hasPermission" -> {
				val permission: PermissionType = json.decodeFromString(arg[0])
				val result: Boolean = this.facade.hasPermission(
					permission,
				)
				return json.encodeToString(result)
			}
			"requestPermission" -> {
				val permission: PermissionType = json.decodeFromString(arg[0])
				val result: Unit = this.facade.requestPermission(
					permission,
				)
				return json.encodeToString(result)
			}
			"getAppLockMethod" -> {
				val result: AppLockMethod = this.facade.getAppLockMethod(
				)
				return json.encodeToString(result)
			}
			"setAppLockMethod" -> {
				val method: AppLockMethod = json.decodeFromString(arg[0])
				val result: Unit = this.facade.setAppLockMethod(
					method,
				)
				return json.encodeToString(result)
			}
			"enforceAppLock" -> {
				val method: AppLockMethod = json.decodeFromString(arg[0])
				val result: Unit = this.facade.enforceAppLock(
					method,
				)
				return json.encodeToString(result)
			}
			"getSupportedAppLockMethods" -> {
				val result: List<AppLockMethod> = this.facade.getSupportedAppLockMethods(
				)
				return json.encodeToString(result)
			}
			"openMailApp" -> {
				val query: String = json.decodeFromString(arg[0])
				val result: Unit = this.facade.openMailApp(
					query,
				)
				return json.encodeToString(result)
			}
			"openCalendarApp" -> {
				val query: String = json.decodeFromString(arg[0])
				val result: Unit = this.facade.openCalendarApp(
					query,
				)
				return json.encodeToString(result)
			}
			"getInstallationDate" -> {
				val result: String = this.facade.getInstallationDate(
				)
				return json.encodeToString(result)
			}
			"requestInAppRating" -> {
				val result: Unit = this.facade.requestInAppRating(
				)
				return json.encodeToString(result)
			}
			"requestWidgetRefresh" -> {
				val result: Unit = this.facade.requestWidgetRefresh(
				)
				return json.encodeToString(result)
			}
			"storeServerRemoteOrigin" -> {
				val origin: String = json.decodeFromString(arg[0])
				val result: Unit = this.facade.storeServerRemoteOrigin(
					origin,
				)
				return json.encodeToString(result)
			}
			"print" -> {
				val result: Unit = this.facade.print(
				)
				return json.encodeToString(result)
			}
			else -> throw Error("unknown method for MobileSystemFacade: $method")
		}
	}
}
